import { Component, createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js';
import type { VideoInfo } from '../../App';
import { calculateBBoxTargets } from '../../engine/bbox-calc';
import { startConversion } from '../../api/convert';
import { listenProgress, stopProgress } from '../../api/progress';
import { uploadFileWithProgress, waitForPreview } from '../../api/upload';
import { fetchEstimate, cancelEstimate } from '../../api/estimate';
import { appState, setAppState, type OutputFormat } from '../../state/app';
import { ACCENT, BG, MONO, DOT_BG_IMAGE } from '../../shared/tokens';
import { XSvg, SettingsSvg, Chip, Cross, CornerCrosshair, GuideLine, buttonProps } from '../../shared/ui';
import LoadingOverlay from '../LoadingOverlay';
import { fmtBytes, pct, extractFrames, scrambleText, useSmoothedProgress } from '../../shared/utils';
import FormatPicker    from '../editor/FormatPicker';
import TrimRow         from '../editor/TrimRow';
import SettingsColumn  from '../editor/SettingsColumn';
import CarrierBricks   from '../loading/CarrierBricks';

// Server-supported formats (lowercase server-side)
const FORMATS = ['GIF', 'AVI', 'MP4', 'MOV', 'WEBM', 'MKV'];

// Space reserved above the video for the top bar (24px pad + 22px btn + 24px bottom margin).
const TOP_BAR_H_PX = 70;
// Closed height of the topBar element — just the button row with no bottom padding.
// Items section sits below this; overflow:hidden clips them until the dropdown opens.
const BTN_ROW_CLOSED_H = 46;

// Space reserved for the VIDEO SETTINGS panel so the video shrinks to make room.
// Portrait: panel sits right of video  → reserve horizontal space.
// Landscape: panel sits below video    → reserve vertical space.
const SETTINGS_RESERVE_W = 500;
const SETTINGS_RESERVE_H = 350;
// Gap between video bbox and settings panel edge. The panel butts up against
// the video edges — its internal padding (see VideoSettings) handles the
// visible spacing, which keeps the inset equal on all four sides.
const SETTINGS_GAP = 0;

// When a result is rendered, the bbox expands outward on all sides so the
// dotted background becomes visible around the processed media — the video
// now "floats" inside the guide lines instead of butting up against them.
// The bbox expansion is clamped to available space; the result media renders
// at the inner bbox size (expansion amount subtracted on each side) so its
// visual footprint stays the same as the editor bbox.
const RESULT_EXPAND = 48;
// Media is inset a little further than RESULT_EXPAND so the corner chips
// (OUTPUT SIZE, delta, DOWNLOAD) have breathing room around the media frame.
const RESULT_MEDIA_INSET = 80;

// While converting, the video bbox morphs into a horizontal loading bar —
// Option 5 (CarrierBricks) renders inside the shrunken bbox. These dims
// match the playground shortlist the user signed off on.
const CONVERTING_BAR_W_RATIO = 0.60;   // 60% of viewport width
const CONVERTING_BAR_H_PX    = 80;
// Wait for the bbox→bar morph (p1_dur + p2_delay + p2_dur = 1050ms) before
// starting the fill animation, so the bar appears at 0% rather than mid-fill.
const CONVERTING_BAR_FADE_MS = 1050;

// When settings is open, keep one bbox dimension at its closed-state size and
// let the opposing side shrink to make room for the panel. This anchors the
// bbox on the non-panel axis — object-fit:cover on the <video> crops the
// overflow, so the video stays visually big instead of shrinking down with
// the available area.
//   Landscape (panel below) → keep width, shrink height (clip from bottom)
//   Portrait  (panel right) → keep height, shrink width  (clip from side)

// ── Types ──────────────────────────────────────────────────────────────────────
interface LayoutCfg {
  PAD_H: number;
  PAD_V: number;
}

interface BoxResult {
  left: number; top: number; right: number; bottom: number;
  isLandscape: boolean;
  gl: string; gr: string; gt: string; gb: string;
  topBarTopPct: string; topBarHPct: string;
  settingsTop: string; settingsLeft: string;
  settingsWidth: string; settingsHeight: string;
}

interface TransitionSet {
  vLines: string; hLines: string; crosses: string;
  bbox: string; topBar: string;
}

// ── Layout computation ─────────────────────────────────────────────────────────
// extraTopPx: additional px to cut from the video top (for open dropdown).
// The video scale/width/bottom are unchanged — only the top shifts down, cropping the video.
// settingsOpen: whether the settings panel is visible. When closed, the video fills
// the full bounding area; when open, space is reserved for the panel.
// hasResult: result is rendered — bbox expands outward by RESULT_EXPAND on all
// sides (clamped to avail). Top-bar space and settings reserve are released
// because those controls are hidden in result mode.
function computeBox(vw: number, vh: number, videoW: number, videoH: number, cfg: LayoutCfg, extraTopPx = 0, settingsOpen = false, hasResult = false, converting = false): BoxResult {
  const isLandscape = videoW >= videoH;
  // Converting state: override bbox to a 60vw × 80px bar centered in the
  // viewport. Top-bar + settings reserves collapse (chrome is hidden while
  // converting). The existing guide / crosshair transitions animate the
  // morph for free.
  if (converting) {
    const boxW = Math.round(vw * CONVERTING_BAR_W_RATIO);
    const boxH = CONVERTING_BAR_H_PX;
    const left = (vw - boxW) / 2;
    const top  = (vh - boxH) / 2;
    const right = left + boxW;
    const bottom = top + boxH;
    return {
      left, top, right, bottom, isLandscape,
      gl: pct(left, vw), gr: pct(right, vw),
      gt: pct(top, vh),  gb: pct(bottom, vh),
      topBarTopPct: pct(top, vh), topBarHPct: '0%',
      settingsTop: pct(top, vh), settingsLeft: pct(left, vw),
      settingsWidth: '0%', settingsHeight: '0%',
    };
  }
  const padH    = vw * cfg.PAD_H;
  const padV    = vh * cfg.PAD_V;
  const topBarH = hasResult ? 0 : TOP_BAR_H_PX;
  const maxReserveW = Math.min(SETTINGS_RESERVE_W, Math.round(vw * 0.45));
  const maxReserveH = Math.min(SETTINGS_RESERVE_H, Math.round(vh * 0.45));
  const reserveW = settingsOpen && !hasResult ? maxReserveW : 0;
  const reserveH = settingsOpen && !hasResult ? maxReserveH : 0;
  const availW  = vw - 2 * padH - (isLandscape ? 0 : reserveW);
  const availH  = vh - 2 * padV - topBarH - (isLandscape ? reserveH : 0);

  // When settings is open, anchor the bbox by keeping one dimension from the
  // closed-state bbox and shrinking the other to fit the reduced available
  // space. object-fit:cover on the <video> handles the aspect mismatch by
  // cropping on the shrinking axis. Closed state uses natural aspect fitting.
  const videoAspect = videoW / videoH;

  let boxW: number, boxH: number;
  if (settingsOpen) {
    // Compute the closed-state bbox (what the bbox would be with no reserve).
    const availW_closed = vw - 2 * padH;
    const availH_closed = vh - 2 * padV - topBarH;
    let closedW: number, closedH: number;
    if (availW_closed / availH_closed > videoAspect) {
      closedH = availH_closed;
      closedW = closedH * videoAspect;
    } else {
      closedW = availW_closed;
      closedH = closedW / videoAspect;
    }
    if (isLandscape) {
      // Panel below → maintain width, shrink height to fit the reduced availH.
      boxW = closedW;
      boxH = Math.min(closedH, availH);
    } else {
      // Panel right → maintain height, shrink width to fit the reduced availW.
      boxH = closedH;
      boxW = Math.min(closedW, availW);
    }
  } else {
    // Closed state: natural aspect fit (bbox aspect == video aspect).
    if (availW / availH > videoAspect) {
      boxH = availH;
      boxW = boxH * videoAspect;
    } else {
      boxW = availW;
      boxH = boxW / videoAspect;
    }
  }
  // Result mode: expand the bbox outward by RESULT_EXPAND on all sides so the
  // guide lines step out from the video frame and the dotted background is
  // visible around it. Clamped to available so we never exceed the viewport
  // padding — if the bbox was already at max on one axis, the expansion just
  // caps there (the inner result content scales down to keep the same inset).
  if (hasResult) {
    boxW = Math.min(availW, boxW + 2 * RESULT_EXPAND);
    boxH = Math.min(availH, boxH + 2 * RESULT_EXPAND);
  }
  // When settings is open in portrait mode, anchor the video to the left
  // edge (at padH) instead of centering it in the reduced availW. This
  // slides the video to the side and frees up the entire remaining width
  // for the settings panel — otherwise a height-constrained portrait video
  // never moves (its width doesn't shrink), and the panel ends up cramped
  // in what's left after the video's horizontal center.
  // Landscape keeps centered: its panel sits below, not beside.
  const left = settingsOpen && !isLandscape
    ? padH
    : (vw - boxW) / 2;
  // Natural (closed) positions
  const naturalTop    = padV + topBarH + (availH - boxH) / 2;
  const naturalBottom = naturalTop + boxH;
  // Open: top shifts down by extraTopPx, bottom stays fixed → video appears cut from top
  const top    = naturalTop + extraTopPx;
  const bottom = naturalBottom;
  const right  = left + boxW;
  const topBarTop        = naturalTop - topBarH;          // always padV + (availH-boxH)/2
  const effectiveTopBarH = BTN_ROW_CLOSED_H + extraTopPx;  // expands to include dropdown area

  // Settings panel fills the space next to / below the video.
  // Portrait:  right of video, top-aligned with video top, same height as video bbox,
  //            extending all the way to the viewport right edge (no outer padH gap).
  // Landscape: below video, same width as video bbox, extending all the way to the
  //            viewport bottom (no outer padV gap).
  // This lets the panel's internal 24px padding create equal inset from the bbox
  // guide lines AND from the viewport edges — otherwise the outer padH/padV
  // would compound with the padding on the edge opposite the video.
  // When closed, width/height collapse to 0 (panel invisible + opacity:0 applied separately).
  const settingsLeftPx   = isLandscape ? left               : right + SETTINGS_GAP;
  const settingsTopPx    = isLandscape ? bottom + SETTINGS_GAP : naturalTop;
  const settingsRightPx  = isLandscape ? right              : vw;
  const settingsBottomPx = isLandscape ? vh                 : naturalBottom;
  const settingsW = settingsOpen ? Math.max(0, settingsRightPx  - settingsLeftPx) : 0;
  const settingsH = settingsOpen ? Math.max(0, settingsBottomPx - settingsTopPx) : 0;

  return {
    left, top, right, bottom, isLandscape,
    gl: pct(left,  vw), gr: pct(right,  vw),
    gt: pct(top,   vh), gb: pct(bottom, vh),
    topBarTopPct: pct(topBarTop,        vh),
    topBarHPct:   pct(effectiveTopBarH, vh),
    settingsTop:    pct(settingsTopPx,  vh),
    settingsLeft:   pct(settingsLeftPx, vw),
    settingsWidth:  pct(settingsW,      vw),
    settingsHeight: pct(settingsH,      vh),
  };
}

// ── Component ──────────────────────────────────────────────────────────────────
const EditorView: Component<{ video: VideoInfo; onBack: () => void }> = (props) => {
  let containerRef!: HTMLDivElement;
  let vLineL!: HTMLDivElement, vLineR!: HTMLDivElement;
  let hLineT!: HTMLDivElement, hLineB!: HTMLDivElement;
  let crossTL!: HTMLDivElement, crossTR!: HTMLDivElement;
  let crossBL!: HTMLDivElement, crossBR!: HTMLDivElement;
  let bboxEl!:     HTMLDivElement;
  let topBarEl!:   HTMLDivElement;
  let settingsEl!: HTMLDivElement;

  // ── Video / timeline refs & state ────────────────────────────────────────────
  let videoRef!: HTMLVideoElement;
  let resultVideoRef: HTMLVideoElement | undefined;
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>();
  let durationInputRef!: HTMLInputElement;
  let isDraggingHandle = false;

  const [duration,        setDuration]        = createSignal(0);
  const [trimStart,       setTrimStart]       = createSignal(0);
  const [trimEnd,         setTrimEnd]         = createSignal(0);
  const [currentTime,     setCurrentTime]     = createSignal(0);
  const [isPlaying,       setIsPlaying]       = createSignal(false);
  const [dragging,        setDragging]        = createSignal(false);
  const [frames,          setFrames]          = createSignal<string[]>([]);
  const [editingDuration, setEditingDuration] = createSignal(false);
  const [draftDuration,   setDraftDuration]   = createSignal('');

  // ── Effective video src: prefer the server-generated preview proxy when the
  // original isn't browser-playable (gif, avi, flv, wmv, ts, …). The memo is
  // reactive, so swapping in the preview URL reloads the <video> element and
  // re-fires loadedmetadata automatically.
  const effectiveSrc = createMemo(() => appState.previewUrl || props.video.objectUrl);

  // ── Conversion state ─────────────────────────────────────────────────────────
  const [isConverting,   setIsConverting]   = createSignal(false);
  // Smoothed progress feeding the loading bar — guarantees a continuous
  // 0→100 sweep over at least 2s, even when SSE updates jump (e.g. 90→100).
  // The `barAnimActive` gate keeps displayed=0 until the bbox→bar morph has
  // finished, so the fill ramp begins from zero rather than mid-fill.
  const [barAnimActive, setBarAnimActive] = createSignal(false);
  const smoothedProgress = useSmoothedProgress(() => appState.progress, 2000, barAnimActive);
  createEffect(() => {
    if (!appState.converting) {
      setBarAnimActive(false);
      return;
    }
    const t = setTimeout(() => setBarAnimActive(true), CONVERTING_BAR_FADE_MS);
    onCleanup(() => clearTimeout(t));
  });
  const [resultUrl,      setResultUrl]      = createSignal<string | null>(null);
  const [resultFilename, setResultFilename] = createSignal<string | null>(null);
  // Hold `converting` true until the bar's animation has caught up, so the
  // result video doesn't flash in mid-fill on a fast conversion.
  createEffect(() => {
    if (!appState.converting) return;
    if (resultUrl() == null) return;
    if (smoothedProgress() < appState.progress) return;
    setIsConverting(false);
    setAppState('converting', false);
  });
  // Latched at run-time: if this job was a stream-copy fast cut, the result
  // file is bit-for-bit the input (minus trim boundaries). Swapping in a
  // second <video> and fading the original out looks like a jarring reload;
  // instead we keep the original video mounted and just morph the chrome /
  // bbox into result shape.
  const [resultWasFastCut, setResultWasFastCut] = createSignal(false);
  // Tracks mouse-press on the result media so we can shrink it while the user
  // has it grabbed. Cleared by mouseup/mouseleave (release off-element) and
  // dragend (drag completes or is cancelled).
  const [isResultPressed, setIsResultPressed] = createSignal(false);
  // Actual byte size of the rendered output — read off Content-Length of the
  // result URL once it's available. Shown in the top-left of the bbox
  // mirroring the EXPECTED SIZE chip during editing.
  const [resultSize, setResultSize] = createSignal<number | null>(null);

  // ── Intro loading overlay (plays inside bounding box on mount) ──────────────
  const [showIntroOverlay, setShowIntroOverlay] = createSignal(true);

  // Brief icon flash over the result video to confirm play/pause toggles.
  // flashKey increments on every toggle so the <Show keyed> remounts the node
  // and the CSS animation replays even on rapid successive toggles.
  const [flashIcon, setFlashIcon] = createSignal<'play' | 'pause' | null>(null);
  const [flashKey, setFlashKey] = createSignal(0);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const triggerFlash = (kind: 'play' | 'pause') => {
    setFlashIcon(kind);
    setFlashKey(k => k + 1);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setFlashIcon(null), 500);
  };
  onCleanup(() => { if (flashTimer) clearTimeout(flashTimer); });

  const trimmedDuration = () => trimEnd() - trimStart();

  // ── Estimated output size ─────────────────────────────────────────────────────

  // Analytical fallback (instant, shown while waiting for server estimate)
  const analyticalSize = () => {
    const dur = trimEnd() - trimStart();
    if (dur <= 0) return '—';
    const fmt = appState.outputFormat;
    const srcW = props.video.width;
    const srcH = props.video.height;
    let bytes: number;
    if (fmt === 'gif') {
      const w = appState.width > 0 ? appState.width : srcW;
      const h = Math.round(w * srcH / srcW);
      bytes = (w * h * appState.fps * dur) / 3;
    } else {
      const w = appState.vidWidth > 0 ? appState.vidWidth : srcW;
      const h = Math.round(w * srcH / srcW);
      const bpp = 0.07 * Math.pow(2, (23 - appState.crf) / 6);
      bytes = (w * h * bpp * 30 * dur) / 8;
      bytes += (128_000 / 8) * dur;
    }
    return fmtBytes(bytes) + '?';
  };

  // displaySize holds only the prefix (digits or "..."). " MB" is rendered
  // statically in the chip; stripped here before the scramble.
  const [displaySize, setDisplaySize] = createSignal('—');
  let scrambleRaf = 0;
  const stripSuffix = (s: string) => s.replace(/ MB\??$/, '').replace(/\?$/, '');

  const scrambleTo = (target: string) => {
    const t = stripSuffix(target) || '—';
    scrambleRaf = scrambleText(
      [{ target: t, setter: setDisplaySize }],
      scrambleRaf,
      { frames: 18, frameMs: 30, chars: '0123456789!@#%&' },
    );
  };

  // Run an estimate — call this explicitly (not reactively on trim)
  const runEstimate = () => {
    const jobId = appState.uploadJobId;
    if (!appState.uploadReady || !jobId) return;
    cancelEstimate();
    scrambleTo('...');
    setAppState('estimating', true);
    fetchEstimate({
      jobId,
      outputFormat: appState.outputFormat,
      fps: Math.round(appState.fps),
      width: appState.outputFormat === 'gif' ? appState.width : appState.vidWidth,
      dither: appState.dither, crf: appState.crf, codec: appState.codec,
      audio: appState.audio, fastCut: appState.fastCut,
      trimStart: trimStart(), trimEnd: trimEnd(),
    }).then(bytes => {
      const result = bytes != null ? fmtBytes(bytes) : analyticalSize();
      if (bytes != null) setAppState('estimatedBytes', bytes);
      setAppState('estimating', false);
      scrambleTo(result);
    });
  };

  // Re-estimate when non-trim params change (debounced), but not during drag
  let estimateTimer = 0;
  createEffect(() => {
    const ready = appState.uploadReady; const jobId = appState.uploadJobId;
    // Touch every conversion param so Solid tracks this effect against them.
    void appState.outputFormat; void appState.fps; void appState.width; void appState.vidWidth;
    void appState.crf; void appState.dither; void appState.codec; void appState.audio; void appState.fastCut;
    clearTimeout(estimateTimer);
    if (!ready || !jobId || isDraggingHandle) return;
    estimateTimer = window.setTimeout(runEstimate, 400);
  });
  onCleanup(() => clearTimeout(estimateTimer));

  const togglePlay = () => {
    const el = hasResult() && resultVideoRef ? resultVideoRef : videoRef;
    if (el.paused) { el.play().catch(() => {}); if (hasResult()) triggerFlash('play'); }
    else { el.pause(); if (hasResult()) triggerFlash('pause'); }
  };

  const handleTrimChange = (start: number, end: number) => {
    setTrimStart(start); setTrimEnd(end);
  };

  const handleSeek = (t: number) => {
    videoRef.currentTime = Math.max(0, Math.min(t, duration()));
    setCurrentTime(videoRef.currentTime);
  };

  const shakeInput = () => {
    durationInputRef.style.animation = 'none';
    void durationInputRef.offsetWidth;
    durationInputRef.style.animation = 'timeline-shake 0.35s ease';
  };

  const commitDuration = () => {
    const parsed = parseFloat(draftDuration().replace(/[^0-9.]/g, ''));
    const isValid = !isNaN(parsed) && parsed >= 1 && parsed <= duration() - trimStart();
    if (isValid) {
      setTrimEnd(Math.min(trimStart() + parsed, duration()));
      setEditingDuration(false);
    } else {
      shakeInput();
      setDraftDuration(String(Math.round(trimmedDuration())));
    }
  };

  // ── Static config ────────────────────────────────────────────────────────────
  const layout: LayoutCfg = { PAD_H: 0.04, PAD_V: 0.05 };

  const anim = {
    timing: { p1_dur: 0.35, p2_dur: 0.35, p2_delay: 0.35, fade_dur: 0.25, fade_delay: 0.55 },
    easing: { x1: 1.0, y1: -0.35, x2: 0.22, y2: 1.15 },
    dropdown: { dur: 0.3 },
    highlight: { dur: 0.200, x1: 0.006, y1: 0.984, x2: 0.000, y2: 1.109 },
  };

  const EASE_STR = `cubic-bezier(${anim.easing.x1},${anim.easing.y1},${anim.easing.x2},${anim.easing.y2})`;

  // ── State ────────────────────────────────────────────────────────────────────
  const [box,           setBox]           = createSignal<BoxResult | null>(null);
  const [vp,            setVp]            = createSignal({ vw: 0, vh: 0 });
  const [fmtOpen,         setFmtOpen]         = createSignal(false);
  const [settingsOpen,    setSettingsOpen]    = createSignal(false);
  // `format` is derived from the store; `displayFormat` is the scramble
  // animation target — separate so mid-animation noise doesn't leak into state.
  const format = () => appState.outputFormat.toUpperCase();
  const [displayFormat, setDisplayFormat] = createSignal(format());

  // ── Format scramble animation ─────────────────────────────────────────────────
  let formatScrambleRaf = 0;
  const scrambleFormat = (target: string) => {
    formatScrambleRaf = scrambleText(
      [{ target, setter: setDisplayFormat }],
      formatScrambleRaf,
      { frames: 14, frameMs: 35 },
    );
  };

  // ── DOM setters ───────────────────────────────────────────────────────────────
  const applyBox = (b: BoxResult) => {
    const { gl, gr, gt, gb } = b;
    vLineL.style.left = gl; vLineR.style.left = gr;
    hLineT.style.top  = gt; hLineB.style.top  = gb;
    crossTL.style.top = `calc(${gt} - 10px)`; crossTL.style.left = `calc(${gl} - 10px)`;
    crossTR.style.top = `calc(${gt} - 10px)`; crossTR.style.left = `calc(${gr} - 10px)`;
    crossBL.style.top = `calc(${gb} - 10px)`; crossBL.style.left = `calc(${gl} - 10px)`;
    crossBR.style.top = `calc(${gb} - 10px)`; crossBR.style.left = `calc(${gr} - 10px)`;
    bboxEl.style.left   = gl;
    bboxEl.style.top    = gt;
    bboxEl.style.width  = `calc(${gr} - ${gl})`;
    bboxEl.style.height = `calc(${gb} - ${gt})`;
    topBarEl.style.left   = gl;
    topBarEl.style.width  = `calc(${gr} - ${gl})`;
    topBarEl.style.top    = b.topBarTopPct;
    topBarEl.style.height = b.topBarHPct;
    settingsEl.style.left   = b.settingsLeft;
    settingsEl.style.top    = b.settingsTop;
    settingsEl.style.width  = b.settingsWidth;
    settingsEl.style.height = b.settingsHeight;
  };

  const snapToIdle = () => {
    const vw = containerRef.offsetWidth; const vh = containerRef.offsetHeight;
    const { x1, y1, x2, y2 } = calculateBBoxTargets(vw, vh, null, 'idle');
    const gl = pct(x1, vw), gr = pct(x2, vw), gt = pct(y1, vh), gb = pct(y2, vh);
    applyBox({
      left: x1, top: y1, right: x2, bottom: y2, isLandscape: true,
      gl, gr, gt, gb,
      topBarTopPct: gt, topBarHPct: '0%',
      settingsTop: gt, settingsLeft: gl,
      settingsWidth: '0%', settingsHeight: '0%',
    });
  };

  // ── Transitions ───────────────────────────────────────────────────────────────
  const buildTr = (a: typeof anim, landscape: boolean, dropdownDur?: number): TransitionSet => {
    const ease = EASE_STR;
    if (dropdownDur != null) {
      const Dd = `${dropdownDur}s ${ease}`;
      return {
        vLines:  `left ${Dd}`,
        hLines:  `top ${Dd}`,
        crosses: `top ${Dd}, left ${Dd}`,
        bbox:    `top ${Dd}, height ${Dd}, left ${Dd}, width ${Dd}`,
        topBar:  `top ${Dd}, height ${Dd}, left ${Dd}, width ${Dd}`,
      };
    }
    const { p1_dur, p2_dur, p2_delay } = a.timing;
    const Pv = landscape ? `${p2_dur}s ${ease} ${p2_delay}s` : `${p1_dur}s ${ease}`;
    const Ph = landscape ? `${p1_dur}s ${ease}`               : `${p2_dur}s ${ease} ${p2_delay}s`;
    return {
      vLines:  `left ${Ph}`,
      hLines:  `top ${Pv}`,
      crosses: `top ${Pv}, left ${Ph}`,
      bbox:    `top ${Pv}, height ${Pv}, left ${Ph}, width ${Ph}`,
      topBar:  `top ${Pv}, height ${Pv}, left ${Ph}, width ${Ph}`,
    };
  };

  const applyTr = (tr: TransitionSet) => {
    vLineL.style.transition = tr.vLines;
    vLineR.style.transition = tr.vLines;
    hLineT.style.transition = tr.hLines;
    hLineB.style.transition = tr.hLines;
    [crossTL, crossTR, crossBL, crossBR].forEach(el => { el.style.transition = tr.crosses; });
    bboxEl.style.transition   = tr.bbox;
    topBarEl.style.transition = tr.topBar;
    // Settings panel geometry animates in sync with the bbox — they share a
    // moving edge, so matching the transition eliminates the "snap + wait"
    // visual. Opacity fade duration matches the dropdown geometry (0.3s) so
    // the panel doesn't vanish mid-close — previously 0.18s, which made the
    // inner boxes appear to "just disappear" while the panel edge was still
    // sliding.
    if (settingsEl) settingsEl.style.transition = tr.bbox + ', opacity 0.3s ease';
    // Force a layout flush so the new transition-duration is committed BEFORE
    // any subsequent applyBox changes the animated properties. Without this,
    // Solid runs applyTr and applyBox in the same synchronous batch — the
    // browser sees both the transition string and the target value change
    // together and skips the animation (properties snap to the end). The
    // triggerEnter path handles this via requestAnimationFrame; this
    // forced reflow does the equivalent job for reactive toggles.
    void bboxEl.offsetHeight;
  };

  // ── Effects ───────────────────────────────────────────────────────────────────
  // Transition effect: picks the right timing whenever fmtOpen OR settingsOpen
  // CHANGES (open OR close). Both toggles use uniform dropdown timing so all
  // animated axes start and end together — the p1/p2 staggered timing (with
  // its 0.35s delay on one axis) is reserved for the enter/exit "cinematic"
  // mount/unmount animation. Using staggered timing here makes the toggle
  // feel laggy: e.g. sliding a portrait video left on settings-open hits
  // `Ph = 0.35s delay + 0.35s` so the user sees nothing for 350ms after
  // clicking, then a slide.
  // Deliberately does NOT read box() so it isn't re-triggered by the box
  // signal updating after the toggle — which would overwrite the transition
  // with the regular p1/p2 one before the animation finishes. IMPORTANT:
  // registered before the setBox/applyBox effects so the new transition is
  // in place before the next applyBox run writes the new geometry.
  const isLandscape = props.video.width >= props.video.height;
  // Gate on `!converting` so the result media (and result-mode layout) waits
  // for the bar's smoothed animation to finish — otherwise on a fast SSE the
  // result video pops in behind the still-filling bar.
  const hasResult = createMemo(() => resultUrl() != null && !appState.converting);

  // Responsive inset / padding — shrink proportionally on small bboxes
  const resultInset = createMemo(() => {
    const b = box();
    if (!b) return RESULT_MEDIA_INSET;
    return Math.min(RESULT_MEDIA_INSET, Math.floor(Math.min(b.right - b.left, b.bottom - b.top) * 0.12));
  });

  // Fast-cut wrapper transition: UNIFORM timing across all four axes so the
  // video scales in unison with the bbox (same duration horizontal + vertical
  // → no moment where one edge hits its endpoint while the other still has
  // 300ms+ to go, which was reading as the video "going full-screen before
  // the bbox catches up"). Duration matches the total end-time of the guide
  // stagger (p1_dur or p2_dur + p2_delay) so bbox chrome and the video
  // finish their morph at the same moment.
  const fastCutWrapTr = createMemo(() => {
    const ease = EASE_STR;
    const { p1_dur, p2_dur, p2_delay } = anim.timing;
    const total = Math.max(p1_dur, p2_dur + p2_delay);
    const T = `${total}s ${ease}`;
    return `top ${T}, bottom ${T}, left ${T}, right ${T}, opacity 0.25s ease`;
  });

  // Fast-cut result wrapper offsets: shape the wrapper to the video's true
  // aspect ratio (fit within the inset area, centered). Keeps the video at
  // 100%/100% of the wrapper with object-fit:cover — no letterbox, no crop,
  // just a frame that matches the processed video's real proportions.
  const fastCutWrap = createMemo(() => {
    const b = box();
    const inset = resultInset();
    if (!b) return { t: inset, l: inset, r: inset, bt: inset };
    const bboxW = b.right - b.left;
    const bboxH = b.bottom - b.top;
    const insetW = bboxW - 2 * inset;
    const insetH = bboxH - 2 * inset;
    if (insetW <= 0 || insetH <= 0) return { t: inset, l: inset, r: inset, bt: inset };
    const videoAspect = props.video.width / props.video.height;
    let wrapW: number, wrapH: number;
    if (insetW / insetH > videoAspect) {
      wrapH = insetH;
      wrapW = wrapH * videoAspect;
    } else {
      wrapW = insetW;
      wrapH = wrapW / videoAspect;
    }
    const padH = (insetW - wrapW) / 2;
    const padV = (insetH - wrapH) / 2;
    return {
      t:  inset + padV,
      l:  inset + padH,
      r:  inset + padH,
      bt: inset + padV,
    };
  });
  const bboxPad = createMemo(() => {
    const b = box();
    if (!b) return 24;
    return Math.min(24, Math.max(8, Math.floor(Math.min(b.right - b.left, b.bottom - b.top) * 0.06)));
  });
  let prevFmtOpen = false;
  let prevSettingsOpen = false;
  let prevHasResult = false;
  let prevConverting = false;
  createEffect(() => {
    const a = anim;
    const isFmtOpen = fmtOpen();
    const isSettingsOpen = settingsOpen();
    const isHasResult = hasResult();
    const isConv = appState.converting;
    const fmtChanged = isFmtOpen !== prevFmtOpen;
    const settingsChanged = isSettingsOpen !== prevSettingsOpen;
    const resultChanged = isHasResult !== prevHasResult;
    const convertingChanged = isConv !== prevConverting;
    prevFmtOpen = isFmtOpen;
    prevSettingsOpen = isSettingsOpen;
    prevHasResult = isHasResult;
    prevConverting = isConv;

    // Settings + format toggles stay on the uniform dropdown timing so the
    // UI feels snappy. All bbox shape changes (editor ↔ loading bar ↔
    // result) follow the staggered p1/p2 rhythm — one axis unfolds before
    // the other, matching the cinematic mount/exit animation.
    void convertingChanged; // all converting transitions now use stagger
    const dropdownDur = (settingsChanged || fmtChanged) ? a.dropdown.dur : undefined;
    applyTr(buildTr(a, isLandscape, dropdownDur));
  });
  createEffect(() => { const b = box(); if (!b) return; applyBox(b); });
  createEffect(() => {
    const l = layout; const { vw, vh } = vp();
    const isOpen = fmtOpen();
    const sOpen = settingsOpen();
    const rHas = hasResult();
    const isConv = appState.converting;
    if (vw === 0 || vh === 0 || !untrack(box)) return;
    // When dropdown opens, push the video top down by the height of the dropdown content.
    // nItems is always FORMATS.length - 1 (exactly one format is selected/excluded).
    let extraTopPx = 0;
    if (isOpen && !rHas && !isConv) {
      const nItems = FORMATS.length - 1;
      extraTopPx = 4 + nItems * 20 + (nItems - 1) * 4;
    }
    setBox(computeBox(vw, vh, props.video.width, props.video.height, l, extraTopPx, sOpen, rHas, isConv));
  });

  // Force-close settings and format dropdown when result is showing —
  // those controls are hidden in result mode so they must not leave the
  // layout in a half-open state.
  createEffect(() => {
    if (hasResult()) {
      if (settingsOpen()) setSettingsOpen(false);
      if (fmtOpen()) setFmtOpen(false);
    }
  });

  // Top bar (FormatPicker + RUN) hidden when a result is displayed.
  // When returning from result → editor, delay the fade-in by the geometry
  // animation duration so PROCESS doesn't flash over the top-right X icon
  // before the top bar has expanded back to its full height.
  createEffect(() => {
    if (!topBarEl) return;
    const show = !hasResult() && !appState.converting;
    const dur = anim.dropdown.dur;
    const opacityTr = show
      ? `opacity ${dur}s ease ${dur}s`
      : `opacity ${dur}s ease`;
    const current = topBarEl.style.transition;
    topBarEl.style.transition = current ? `${current}, ${opacityTr}` : opacityTr;
    topBarEl.style.opacity       = show ? '1' : '0';
    topBarEl.style.pointerEvents = show ? 'auto' : 'none';
  });

  // Toggle settings panel visibility. The transition (geometry + opacity) is
  // set by applyTr above, so the panel's geometry animates in sync with the
  // bbox. Here we just update the final opacity / pointer-events.
  createEffect(() => {
    const open = settingsOpen() && !appState.converting;
    if (!settingsEl) return;
    settingsEl.style.opacity = open ? '1' : '0';
    settingsEl.style.pointerEvents = open ? 'auto' : 'none';
  });

  // ── Animations ────────────────────────────────────────────────────────────────
  let isExiting = false;

  const triggerEnter = () => {
    const a = anim; const l = layout;
    const vw = containerRef.offsetWidth; const vh = containerRef.offsetHeight;
    const target = computeBox(vw, vh, props.video.width, props.video.height, l);
    const tr = buildTr(a, target.isLandscape);
    [vLineL, vLineR, hLineT, hLineB, crossTL, crossTR, crossBL, crossBR, bboxEl, topBarEl]
      .forEach(el => { el.style.transition = 'none'; });
    snapToIdle();
    topBarEl.style.opacity = '0';
    settingsEl.style.opacity = '0';
    void containerRef.getBoundingClientRect();
    requestAnimationFrame(() => {
      applyTr(tr); void containerRef.getBoundingClientRect(); applyBox(target);
      requestAnimationFrame(() => {
        const { fade_dur, fade_delay } = a.timing;
        topBarEl.style.transition  = tr.topBar + `, opacity ${fade_dur}s ease ${fade_delay}s`;
        topBarEl.style.opacity     = '1';
        // Settings panel stays hidden on mount; it opens only when the user
        // clicks the arrow button on the video bbox. Transition is already
        // set by applyTr above — only touch opacity here.
        settingsEl.style.opacity   = settingsOpen() ? '1' : '0';
        const endMs = Math.max(a.timing.p1_dur, a.timing.p2_dur + a.timing.p2_delay, fade_delay + fade_dur) * 1000 + 32;
        setTimeout(() => {
          const nVw = containerRef.offsetWidth; const nVh = containerRef.offsetHeight;
          setVp({ vw: nVw, vh: nVh });
          setBox(computeBox(nVw, nVh, props.video.width, props.video.height, layout));
        }, endMs);
      });
    });
  };

  const triggerExit = () => {
    if (isExiting) return; isExiting = true;
    setAppState('selectedFile',   null);
    setAppState('fileUrl',        null);
    setAppState('converting',     false);
    setAppState('progress',       0);
    setAppState('progressMsg',    '');
    setAppState('uploadJobId',    null);
    setAppState('uploadReady',    false);
    setAppState('estimatedBytes', null);
    setAppState('estimating',     false);
    setAppState('previewUrl',     null);
    setAppState('inputFormat',    null);
    setAppState('needsProxy',     false);
    cancelEstimate();
    stopProgress();
    const a = anim; const b = box();
    if (!b) { props.onBack(); return; }
    const tr = buildTr(a, !b.isLandscape);
    const { fade_dur } = a.timing;
    requestAnimationFrame(() => {
      applyTr(tr);
      topBarEl.style.transition   = tr.topBar + `, opacity ${fade_dur}s ease`;
      // settingsEl transition already set by applyTr; just fade opacity.
      void containerRef.getBoundingClientRect();
      snapToIdle();
      topBarEl.style.opacity = '0'; settingsEl.style.opacity = '0';
      const endMs = Math.max(a.timing.p1_dur, a.timing.p2_dur + a.timing.p2_delay, fade_dur) * 1000 + 32;
      setTimeout(() => props.onBack(), endMs);
    });
  };

  // ── Run handler ─────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (isConverting()) return;
    // Fast cut = stream-copy ffmpeg: the job finishes in a few hundred ms,
    // so flashing the loading bar in and out looks broken. Skip the bbox
    // morph entirely for fast cut — result bbox appears directly.
    const isFastCut = appState.fastCut &&
      (appState.inputFormat ?? '').toLowerCase() ===
      (appState.outputFormat ?? '').toLowerCase();

    setIsConverting(true);
    setResultWasFastCut(isFastCut);
    if (!isFastCut) {
      setAppState('converting', true);
      setAppState('progress',    0);
      setAppState('progressMsg', 'Starting...');
    }
    setResultUrl(null);
    setResultFilename(null);

    const jobId = await startConversion(trimStart(), trimEnd());
    if (!jobId) {
      setIsConverting(false);
      setAppState('converting', false);
      return;
    }

    listenProgress(jobId, (url, filename, outputSize) => {
      setResultUrl(url);
      setResultFilename(filename);
      if (outputSize != null) setResultSize(outputSize);
      // Don't flip `converting` here — the smoothed-progress effect below
      // does it once the loading bar's 3s animation has caught up to 100,
      // so the result video can't appear mid-fill on a fast conversion.
    }, () => {
      setIsConverting(false);
      setAppState('converting', false);
    });
  };

  // ── Mount ─────────────────────────────────────────────────────────────────────
  onMount(() => {
    setVp({ vw: containerRef.offsetWidth, vh: containerRef.offsetHeight });
    triggerEnter();
    const ro = new ResizeObserver(() => {
      if (isExiting) return;
      const vw = containerRef.offsetWidth; const vh = containerRef.offsetHeight;
      if (vw === vp().vw && vh === vp().vh) return;
      setVp({ vw, vh });
    });
    ro.observe(containerRef);

    // ── Seed app state with the newly loaded video ───────────────────────────
    setAppState('selectedFile',   props.video.file ?? null);
    setAppState('fileUrl',        props.video.url  ?? null);
    setAppState('estimatedBytes', null);
    setAppState('uploadReady',    false);
    setAppState('uploadJobId',    null);
    setAppState('previewUrl',     null);
    setAppState('inputFormat',    null);
    setAppState('needsProxy',     false);

    // Default output = same format as input whenever we accept it as an output
    // (gif, mp4, mov, mkv, webm, avi). For inputs we don't round-trip
    // (m4v/flv/wmv/ts/mts/3gp/ogv/no-extension), default to mp4 — safest
    // universal video container.
    const srcName = props.video.file?.name ?? props.video.name ?? '';
    const srcExt = (srcName.split('.').pop() || '').toLowerCase();
    const SAMEFORMAT_OUTPUTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif'];
    const pickedFormat = SAMEFORMAT_OUTPUTS.includes(srcExt) ? srcExt : 'mp4';
    setAppState('outputFormat', pickedFormat as OutputFormat);
    setDisplayFormat(pickedFormat.toUpperCase());

    // ── Upload to server ───────────────────────────────────────────────────
    // IdleView now handles both file upload (XHR + progress bar) and URL
    // fetch (SSE + progress bar) BEFORE transitioning here, so uploadReady
    // should already be true. The fallback below covers legacy callers that
    // transition straight into EditorView without uploading.
    if (!appState.uploadReady && props.video.file) {
      uploadFileWithProgress(props.video.file).then(result => {
        if (result) {
          setAppState('uploadJobId',  result.jobId);
          setAppState('currentJobId', result.jobId);
          setAppState('uploadReady',  true);
          setAppState('inputFormat',  result.inputFormat);
          setAppState('needsProxy',   !!result.needsProxy);
          if (result.needsProxy) {
            waitForPreview(result.jobId).then(url => {
              if (url) setAppState('previewUrl', url);
            });
          }
        }
      });
    } else if (!appState.uploadReady && props.video.url && appState.currentJobId) {
      // URL mode fallback (IdleView should have already set these).
      setAppState('uploadJobId', appState.currentJobId);
      setAppState('uploadReady', true);
      setAppState('inputFormat', 'mp4');
    }

    // ── Video setup ────────────────────────────────────────────────────────────
    // loadedmetadata fires on each src change — when the preview proxy swaps
    // in (gif/avi inputs), we rebuild the trim range and thumbnail strip
    // against the playable URL. extractFrames uses the video's current src so
    // it always operates on something the browser can decode.
    videoRef.addEventListener('loadedmetadata', () => {
      const d = videoRef.duration;
      if (!isFinite(d) || d <= 0) return;
      setDuration(d);
      if (trimEnd() === 0 || trimEnd() > d) { setTrimStart(0); setTrimEnd(d); }
      extractFrames(videoRef.currentSrc || effectiveSrc(), d, 20).then(setFrames);
    });

    let rafId = 0;
    const tick = () => {
      const ct = videoRef.currentTime;
      const end = trimEnd(); const start = trimStart();
      if (!isDraggingHandle && (ct >= end || ct < start)) {
        videoRef.currentTime = start;
      }
      const next = videoRef.currentTime;
      if (next !== currentTime()) setCurrentTime(next);
      rafId = requestAnimationFrame(tick);
    };
    const startLoop = () => { if (!rafId) rafId = requestAnimationFrame(tick); };
    const stopLoop = () => { cancelAnimationFrame(rafId); rafId = 0; };

    videoRef.addEventListener('play',  () => { setIsPlaying(true); startLoop(); });
    videoRef.addEventListener('pause', () => { setIsPlaying(false); stopLoop(); });
    startLoop();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !editingDuration()) { e.preventDefault(); togglePlay(); }
    };
    document.addEventListener('keydown', onKeyDown);

    onCleanup(() => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(scrambleRaf);
      cancelAnimationFrame(formatScrambleRaf);
      document.removeEventListener('keydown', onKeyDown);
      stopProgress();
      cancelEstimate();
    });
  });

  const startEditDuration = () => {
    setDraftDuration(String(Math.round(trimmedDuration())));
    setEditingDuration(true);
  };

  // Close the result and return to the editor. Animation is handled by the
  // createEffect tree — clearing resultUrl flips hasResult to false, which
  // triggers the same uniform-timing transition used to enter result mode.
  const closeResult = () => {
    setResultUrl(null);
    setResultFilename(null);
    setResultSize(null);
    setResultWasFastCut(false);
    setIsConverting(false);
    setAppState('converting', false);
    setAppState('progress', 0);
    setAppState('progressMsg', '');
    stopProgress();
  };

  // Fetch the output size from Content-Length as soon as the result URL is
  // known. Kept out of the reactive tracking body via an IIFE so the async
  // work doesn't re-trigger the effect. The post-fetch guard prevents a stale
  // response from overwriting size for a newer result (rapid run/close).
  createEffect(() => {
    const url = resultUrl();
    if (!url) { setResultSize(null); return; }
    if (resultSize() != null) return; // already set from SSE outputSize
    (async () => {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        const len = res.headers.get('content-length');
        if (len && resultUrl() === url) setResultSize(parseInt(len, 10));
      } catch { /* ignore — chip falls back to '—' */ }
    })();
  });

  // Scrambled display for the rendered size — mirrors the EXPECTED SIZE
  // scramble so the two chips read as before/after of the same value.
  const [displayResultSize, setDisplayResultSize] = createSignal('—');
  let resultScrambleRaf = 0;
  createEffect(() => {
    const sz = resultSize();
    if (sz == null) { setDisplayResultSize('—'); return; }
    const num = fmtBytes(sz).replace(/ MB$/, '');
    resultScrambleRaf = scrambleText(
      [{ target: num, setter: setDisplayResultSize }],
      resultScrambleRaf,
      { frames: 18, frameMs: 30, chars: '0123456789!@#%&' },
    );
  });
  onCleanup(() => cancelAnimationFrame(resultScrambleRaf));

  // Percentage change from source → result. Uses Unicode minus for the
  // negative sign so it visually matches `+` in width. Returns null when
  // we can't compute it (no source size, no result size yet).
  const resultDelta = () => {
    const sz = resultSize();
    const src = props.video.sizeBytes;
    if (sz == null || !src) return null;
    const pct = Math.round((sz - src) / src * 100);
    if (pct === 0) return '±0%';
    return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
  };

  // Drag support — the user wants to grab the processed video from the bbox
  // and drop it into another app (messaging apps, the filesystem via the
  // Chrome DownloadURL convention, etc.). We hand off the absolute URL plus
  // a download hint so Chromium-based shells will save the correct filename.
  const handleResultDragStart = (e: DragEvent) => {
    setIsResultPressed(true);
    const url = resultUrl();
    if (!url || !e.dataTransfer) return;
    const fullUrl = new URL(url, window.location.origin).href;
    const filename = resultFilename() || `output.${appState.outputFormat}`;
    const mime = appState.outputFormat === 'gif' ? 'image/gif' : `video/${appState.outputFormat}`;
    e.dataTransfer.setData('text/uri-list', fullUrl);
    e.dataTransfer.setData('text/plain', fullUrl);
    e.dataTransfer.setData('DownloadURL', `${mime}:${filename}:${fullUrl}`);
    e.dataTransfer.effectAllowed = 'copyLink';
  };

  // Result media shares these handlers so both the <video> and <img> tracks
  // press/hover state the same way. mouseleave covers the case where the
  // user presses, then releases off-element (no mouseup on the element);
  // dragend covers drag completion where mouseup does not fire on the source.
  const resultMediaEvents = {
    onMouseDown:  () => setIsResultPressed(true),
    onMouseUp:    () => setIsResultPressed(false),
    onMouseLeave: () => setIsResultPressed(false),
    onDragStart:  handleResultDragStart,
    onDragEnd:    () => setIsResultPressed(false),
  };

  return (
    <div ref={containerRef} style={{ position: 'fixed', top: '0', left: '0', right: '0', bottom: '0', background: BG, overflow: 'hidden', '-webkit-app-region': 'drag' }}>
      <style>{`
        @keyframes timeline-shake {
          0%   { transform: translateX(0); }
          15%  { transform: translateX(-5px); }
          35%  { transform: translateX(5px); }
          55%  { transform: translateX(-4px); }
          75%  { transform: translateX(3px); }
          90%  { transform: translateX(-2px); }
          100% { transform: translateX(0); }
        }
        @keyframes result-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        /* Result media: 1px outline so the frame separates from the dotted
           background, plus subtle scale feedback — 1.02x on hover invites
           interaction, 0.98x on press/drag signals the grab. */
        .result-media {
          border: 1px solid ${ACCENT};
          transition: transform 0.18s ease;
          transform-origin: center;
          cursor: grab;
        }
        .result-media:hover { transform: scale(1.02); }
        .result-media.is-pressed,
        .result-media.is-pressed:hover {
          transform: scale(0.98);
          cursor: grabbing;
        }
        /* DOWNLOAD chip: on hover, the arrow snaps down and springs back —
           a quick "pull" cue that reinforces the download metaphor. */
        @keyframes download-arrow-bounce {
          0%, 55%, 100% { transform: translateY(0); }
          25%           { transform: translateY(2px); }
        }
        .download-chip:hover .download-arrow {
          animation: download-arrow-bounce 1s cubic-bezier(0.22, 1.15, 0.5, 1) infinite;
        }
        /* Play/pause flash: brief icon burst centered on the result video. */
        @keyframes play-flash {
          0%   { opacity: 0; transform: scale(0.7); }
          20%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.4); }
        }
        .play-flash {
          animation: play-flash 0.5s ease-out forwards;
        }
      `}</style>

      {/* ── Bounding box (video + overlay) ─────────────────────────────────── */}
      <div ref={bboxEl} style={{ position: 'absolute', overflow: 'hidden', '-webkit-app-region': 'no-drag' }}>
        {/* Dotted background — rendered FIRST so it sits behind the input
            video wrapper. In fast-cut result the video morphs into an
            inset frame and the dotted bg peeks through the surrounding
            area; for non-fast-cut results the faded-to-0 input video lets
            the dots show through on the whole bbox. */}
        <Show when={hasResult()}>
          <div
            style={{
              position: 'absolute', inset: '0',
              'background-image': DOT_BG_IMAGE,
              'background-size': '32px 32px',
              'background-position': '50% 50%',
              'pointer-events': 'none',
              animation: 'result-fade-in 0.3s ease both',
            }}
          />
        </Show>

        {/* Input video — kept mounted across result transitions so playback
            state, refs, and event listeners survive. Faded out in result mode.
            src is reactive so the preview proxy (gif/avi/… inputs) swaps in
            automatically once the server finishes generating it. */}
        {/* Wrapper handles the position/inset morph; the <video> inside
            stays at 100%/100% so object-fit:cover keeps working. For the
            fast-cut result state the wrapper's top/left/right/bottom are
            computed so the wrapper itself takes the video's true aspect
            ratio inside the inset area — no letterbox, no crop, just a
            frame that matches the processed video's real proportions. */}
        <div style={{
          position: 'absolute',
          top:    hasResult() && resultWasFastCut() ? `${fastCutWrap().t}px`  : '0',
          left:   hasResult() && resultWasFastCut() ? `${fastCutWrap().l}px`  : '0',
          right:  hasResult() && resultWasFastCut() ? `${fastCutWrap().r}px`  : '0',
          bottom: hasResult() && resultWasFastCut() ? `${fastCutWrap().bt}px` : '0',
          opacity: (hasResult() && !resultWasFastCut()) || appState.converting ? '0' : '1',
          'pointer-events': hasResult() && resultWasFastCut() ? 'auto' : 'none',
          transition: fastCutWrapTr(),
        }}>
          <video
            ref={el => { videoRef = el; setVideoEl(el); }}
            src={effectiveSrc()}
            autoplay muted playsinline
            classList={{
              'result-media': hasResult() && resultWasFastCut(),
              'is-pressed':   hasResult() && resultWasFastCut() && isResultPressed(),
            }}
            draggable={hasResult() && resultWasFastCut()}
            {...(hasResult() && resultWasFastCut() ? resultMediaEvents : {})}
            style={{
              width: '100%', height: '100%', display: 'block', 'object-fit': 'cover',
            }}
          />
        </div>

        {/* Converting layer — CarrierBricks fills the morphed bbox while
            converting. The catchup effect above holds `converting` true
            until the smoothed bar reaches the real target, so unmounting
            purely on `converting` keeps the bar visible through the ramp
            and then cleanly removes it — no stale "empty bricks" overlay
            if smoothing ever stalls.
            Fade-in delayed so the bar only appears once the bbox has finished
            its staggered morph into bar shape (p1+p2_delay+p2 ≈ 0.70s). */}
        <Show when={appState.converting}>
          <div style={{
            position: 'absolute', inset: '0',
            animation: `result-fade-in 0.2s ease ${anim.timing.p1_dur + anim.timing.p2_delay + anim.timing.p2_dur}s both`,
          }}>
            <CarrierBricks progress={smoothedProgress()} height={CONVERTING_BAR_H_PX} />
          </div>
        </Show>

        {/* Floating result media — separate element only for non-fast-cut
            results. For fast-cut the input <video> above has already morphed
            into this position, so rendering a second video would stack them. */}
        <Show when={hasResult() && !resultWasFastCut()}>
          <div
            style={{
              position: 'absolute',
              top: `${resultInset()}px`, left: `${resultInset()}px`,
              right: `${resultInset()}px`, bottom: `${resultInset()}px`,
              display: 'flex', 'align-items': 'center', 'justify-content': 'center',
              'pointer-events': 'none',
              animation: 'result-fade-in 0.3s ease both',
            }}
          >
            <Show
              when={appState.outputFormat === 'gif'}
              fallback={
                <video
                  ref={el => { resultVideoRef = el; }}
                  src={resultUrl()!}
                  autoplay loop playsinline
                  draggable={true}
                  classList={{ 'result-media': true, 'is-pressed': isResultPressed() }}
                  {...resultMediaEvents}
                  style={{
                    'max-width': '100%', 'max-height': '100%',
                    display: 'block',
                    'pointer-events': 'auto',
                  }}
                />
              }
            >
              <img
                src={resultUrl()!}
                alt="Result"
                draggable={true}
                classList={{ 'result-media': true, 'is-pressed': isResultPressed() }}
                {...resultMediaEvents}
                style={{
                  'max-width': '100%', 'max-height': '100%',
                  display: 'block',
                  'pointer-events': 'auto',
                }}
              />
            </Show>
            <Show when={flashIcon() && flashKey()} keyed>
              {() => (
                <div
                  class="play-flash"
                  style={{
                    position: 'absolute',
                    'pointer-events': 'none',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    width: '72px', height: '72px',
                    'border-radius': '50%',
                    background: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                  }}
                >
                  {flashIcon() === 'play' ? (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="6" y="5" width="4" height="14" />
                      <rect x="14" y="5" width="4" height="14" />
                    </svg>
                  )}
                </div>
              )}
            </Show>
          </div>
        </Show>

        {/* Intro loading overlay — covers bbox while video loads */}
        <Show when={showIntroOverlay()}>
          <div style={{ position: 'absolute', inset: '0', overflow: 'hidden', 'z-index': '10' }}>
            <LoadingOverlay onDone={() => setShowIntroOverlay(false)} delay={850} />
          </div>
        </Show>
        {/* Overlay (EXPECTED SIZE + cross + X up top; trim row at bottom).
            In result mode the editor chrome fades out and a DOWNLOAD chip +
            close-X take the place of the Settings + Cancel icons. */}
        <div style={{
          position: 'absolute', inset: '0',
          display: 'flex', 'flex-direction': 'column',
          'justify-content': 'space-between',
          padding: `${bboxPad()}px`,
          'pointer-events': 'none',
          'box-sizing': 'border-box',
        }}>
          <div style={{
            display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-start', width: '100%',
            opacity: appState.converting ? '0' : '1',
            transition: 'opacity 0.3s ease',
          }}>
            <div style={{ position: 'relative' }}>
              <div style={{
                display: 'flex', 'flex-direction': 'column',
                opacity: hasResult() ? '0' : '1',
                transition: 'opacity 0.3s ease',
              }}>
                <Chip>EXPECTED SIZE</Chip>
                <Chip>{displaySize() === '—' ? '—' : `${displaySize()} MB`}</Chip>
              </div>
              {/* Rendered-size chip — overlays on top of EXPECTED SIZE at the
                  same position. Cross-fades via opacity; pointer-events keep
                  whichever chip is visible the only one reachable. The delta
                  chip lives in the bottom row instead (see below). */}
              <div style={{
                position: 'absolute', top: '0', left: '0',
                display: 'flex', 'flex-direction': 'column',
                opacity: hasResult() ? '1' : '0',
                transition: 'opacity 0.3s ease',
                'pointer-events': hasResult() ? 'auto' : 'none',
              }}>
                <Chip>OUTPUT SIZE</Chip>
                <Chip>{displayResultSize() === '—' ? '—' : `${displayResultSize()} MB`}</Chip>
              </div>
            </div>
            {/* Top-center Cross — kept visible in both editor and result
                states so the top-row rhythm (left group · cross · right group)
                reads identically before and after processing. */}
            <Cross />
            <div style={{ display: 'flex', gap: '6px', 'align-items': 'flex-start' }}>
              <Show
                when={hasResult()}
                fallback={
                  <>
                    <div
                      title="Settings"
                      style={{ cursor: 'pointer', 'pointer-events': 'auto' }}
                      {...buttonProps(() => setSettingsOpen(o => !o), 'Settings')}
                    >
                      <SettingsSvg width={20} height={22} open={settingsOpen()} />
                    </div>
                    <div
                      title="Cancel"
                      style={{ cursor: 'pointer', 'pointer-events': 'auto' }}
                      {...buttonProps(triggerExit, 'Cancel')}
                    >
                      <XSvg width={20} height={22} />
                    </div>
                  </>
                }
              >
                {/* Result state: X alone in top-right. DOWNLOAD chip moved to
                    the bottom-right of the overlay (mirrors Paper design). */}
                <div
                  title="Close result"
                  style={{ cursor: 'pointer', 'pointer-events': 'auto' }}
                  {...buttonProps(closeResult, 'Close result')}
                >
                  <XSvg width={20} height={22} />
                </div>
              </Show>
            </div>
          </div>
          {/* Bottom slot — hosts either the TrimRow (editor mode) or the
              result's delta · FORMAT chip + mirrored Cross. Both share this
              relative container so the delta row anchors to the bottom edge
              of the TrimRow's reserved space, keeping vertical alignment
              stable across the cross-fade. */}
          <div style={{
            position: 'relative', 'align-self': 'stretch',
            opacity: appState.converting ? '0' : '1',
            transition: 'opacity 0.3s ease',
            'pointer-events': appState.converting ? 'none' : 'auto',
          }}>
            <div style={{
              opacity: hasResult() ? '0' : '1',
              transition: 'opacity 0.3s ease',
              'pointer-events': hasResult() ? 'none' : 'auto',
            }}>
              <TrimRow
                duration={duration()}
                trimStart={trimStart()}
                trimEnd={trimEnd()}
                currentTime={currentTime()}
                frames={frames()}
                isPlaying={isPlaying()}
                dragging={dragging()}
                editingDuration={editingDuration()}
                draftDuration={draftDuration()}
                onTogglePlay={togglePlay}
                onTrimChange={handleTrimChange}
                onSeek={handleSeek}
                onHandleDragStart={() => { isDraggingHandle = true; setDragging(true); }}
                onHandleDragEnd={() => { isDraggingHandle = false; setDragging(false); runEstimate(); }}
                onStartEditDuration={startEditDuration}
                onDraftDurationInput={setDraftDuration}
                onCommitDuration={commitDuration}
                onCancelEditDuration={() => setEditingDuration(false)}
                setDurationInputRef={(el) => { durationInputRef = el; }}
              />
            </div>
            {/* Result bottom row: [delta chip] [+] [DOWNLOAD ↓]. 3-column
                grid keeps the Cross centered regardless of chip width,
                mirroring the top row's left · center · right rhythm. */}
            <div style={{
              position: 'absolute', bottom: '0', left: '0', right: '0',
              display: 'grid',
              'grid-template-columns': '1fr auto 1fr',
              'align-items': 'end',
              opacity: hasResult() ? '1' : '0',
              transition: 'opacity 0.3s ease',
              'pointer-events': hasResult() ? 'auto' : 'none',
            }}>
              <div style={{ 'justify-self': 'start' }}>
                <Chip>{resultDelta() ? `${resultDelta()} - ${appState.outputFormat.toUpperCase()}` : appState.outputFormat.toUpperCase()}</Chip>
              </div>
              <Cross />
              <a
                class="download-chip"
                href={`/download/${appState.currentJobId}`}
                download={resultFilename() || 'output'}
                title="Download"
                style={{
                  'justify-self': 'end',
                  'text-decoration': 'none',
                  'pointer-events': 'auto',
                  display: 'inline-flex',
                  'align-items': 'center',
                  gap: '2px',
                  background: ACCENT, color: BG,
                  'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
                  'white-space': 'nowrap',
                  cursor: 'pointer',
                }}
              >
                <span>DOWNLOAD</span>
                {/* Down-arrow glyph — sized to match the "↓" character used
                    in other chips so the button reads as a single Chip unit
                    rather than a padded button. */}
                <svg
                  class="download-arrow"
                  width={10} height={11}
                  viewBox="0 0 44 47" fill="none"
                  style={{ 'flex-shrink': '0' }}
                >
                  <path d="M17.6304 40.8787L37.9207 20.1144L41.9788 24.2672L21.6885 45.0315L17.6304 40.8787Z" fill={BG} />
                  <path d="M24.5909 1.15742L24.5909 38.8254L18.7861 38.6914L18.7861 1.02336L24.5909 1.15742Z" fill={BG} />
                  <path d="M1.39817 24.2672L21.6885 45.0315L25.7465 40.8787L5.45623 20.1144L1.39817 24.2672Z" fill={BG} />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Top bar: format dropdown + PROCESS. Height animated by effects. ── */}
      <div ref={topBarEl} style={{ position: 'absolute', 'box-sizing': 'border-box', overflow: 'hidden', '-webkit-app-region': 'no-drag' }}>
        <FormatPicker
          formats={FORMATS}
          format={format()}
          displayFormat={displayFormat()}
          open={fmtOpen()}
          onToggleOpen={() => setFmtOpen(o => !o)}
          onSelect={(fmt) => {
            setAppState('outputFormat', fmt.toLowerCase() as OutputFormat);
            scrambleFormat(fmt);
            setFmtOpen(false);
          }}
          onRun={handleRun}
        />
      </div>

      <SettingsColumn ref={el => settingsEl = el} videoEl={videoEl()} open={settingsOpen()} isPortrait={!isLandscape} />

      {/* ── Guide lines ─────────────────────────────────────────────────────── */}
      <GuideLine orientation="v" ref={el => vLineL = el} />
      <GuideLine orientation="v" ref={el => vLineR = el} />
      <GuideLine orientation="h" ref={el => hLineT = el} />
      <GuideLine orientation="h" ref={el => hLineB = el} />

      {/* ── Corner crosshairs ───────────────────────────────────────────────── */}
      <CornerCrosshair ref={el => crossTL = el} />
      <CornerCrosshair ref={el => crossTR = el} />
      <CornerCrosshair ref={el => crossBL = el} />
      <CornerCrosshair ref={el => crossBR = el} />
    </div>
  );
};

export default EditorView;
