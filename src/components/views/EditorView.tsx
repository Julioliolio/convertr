import { Component, createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js';
import type { VideoInfo } from '../../App';
import { calculateBBoxTargets } from '../../engine/bbox-calc';
import { startConversion } from '../../api/convert';
import { listenProgress, stopProgress } from '../../api/progress';
import { uploadFile } from '../../api/upload';
import { fetchEstimate, cancelEstimate } from '../../api/estimate';
import { appState, setAppState } from '../../state/app';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { XSvg, SettingsSvg, Chip, Cross, CornerCrosshair, GuideLine } from '../../shared/ui';
import LoadingOverlay from '../LoadingOverlay';
import { fmtBytes, extractFrames, scrambleText } from '../../shared/utils';
import ConvertingOverlay from '../editor/ConvertingOverlay';
import FormatPicker    from '../editor/FormatPicker';
import TrimRow         from '../editor/TrimRow';
import SettingsColumn  from '../editor/SettingsColumn';

// Server-supported formats (lowercase server-side)
const FORMATS = ['GIF', 'AVI', 'MP4', 'MOV', 'WEBM', 'MKV'];

const pct = (v: number, of: number) => (v / of * 100).toFixed(4) + '%';

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
function computeBox(vw: number, vh: number, videoW: number, videoH: number, cfg: LayoutCfg, extraTopPx = 0, settingsOpen = false, hasResult = false): BoxResult {
  const isLandscape = videoW >= videoH;
  const padH    = vw * cfg.PAD_H;
  const padV    = vh * cfg.PAD_V;
  const topBarH = hasResult ? 0 : TOP_BAR_H_PX;
  const reserveW = settingsOpen && !hasResult ? SETTINGS_RESERVE_W : 0;
  const reserveH = settingsOpen && !hasResult ? SETTINGS_RESERVE_H : 0;
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

  // ── Conversion state ─────────────────────────────────────────────────────────
  const [isConverting,   setIsConverting]   = createSignal(false);
  const [resultUrl,      setResultUrl]      = createSignal<string | null>(null);
  const [resultFilename, setResultFilename] = createSignal<string | null>(null);
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

  // ── Size display with scramble animation ────────────────────────────────────
  // displaySize holds only the prefix (digits or "..."), " MB" is rendered statically
  const SCRAMBLE_CHARS = '0123456789!@#%&';
  const [displaySize, setDisplaySize] = createSignal('—');
  let scrambleRaf = 0;

  // Strip trailing " MB" or "?" suffix before scrambling, add back in render
  const stripSuffix = (s: string) => s.replace(/ MB\??$/, '').replace(/\?$/, '');

  const scrambleTo = (target: string) => {
    cancelAnimationFrame(scrambleRaf);
    const from = displaySize();
    const t = stripSuffix(target);
    const len = Math.max(from.length, t.length);
    const pad = (s: string) => s.padEnd(len, ' ');
    const f = pad(from), tt = pad(t);
    const totalFrames = 18;
    const frameMs = 30;
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      if (now - last < frameMs) { scrambleRaf = requestAnimationFrame(tick); return; }
      last = now;
      frame++;
      if (frame >= totalFrames) { setDisplaySize(t.trimEnd() || '—'); return; }
      const resolved = Math.floor((frame / totalFrames) * len);
      const result = tt.split('').map((ch, i) => {
        if (i < resolved) return tt[i];
        if (f[i] === ' ' && tt[i] === ' ') return ' ';
        return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }).join('').trimEnd();
      setDisplaySize(result || '—');
      scrambleRaf = requestAnimationFrame(tick);
    };
    scrambleRaf = requestAnimationFrame(tick);
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
    // Re-run whenever any conversion param changes
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    appState.outputFormat; appState.fps; appState.width; appState.vidWidth;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    appState.crf; appState.dither; appState.codec;
    clearTimeout(estimateTimer);
    if (!ready || !jobId || isDraggingHandle) return;
    estimateTimer = window.setTimeout(runEstimate, 400);
  });
  onCleanup(() => clearTimeout(estimateTimer));

  const togglePlay = () => {
    if (videoRef.paused) videoRef.play().catch(() => {});
    else videoRef.pause();
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
  const [format,          setFormat]          = createSignal(FORMATS[0]);
  const [displayFormat,   setDisplayFormat]   = createSignal(FORMATS[0]);

  // ── Format scramble animation ─────────────────────────────────────────────────
  let formatScrambleRaf = 0;
  const scrambleFormat = (target: string) => {
    formatScrambleRaf = scrambleText(
      [{ target, setter: setDisplayFormat }],
      formatScrambleRaf,
      { frames: 14, frameMs: 35 },
    );
  };

  // Keep appState.outputFormat in sync with local format picker
  createEffect(() => {
    setAppState('outputFormat', format().toLowerCase() as any);
  });

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
  const hasResult = createMemo(() => resultUrl() != null);
  let prevFmtOpen = false;
  let prevSettingsOpen = false;
  let prevHasResult = false;
  createEffect(() => {
    const a = anim;
    const isFmtOpen = fmtOpen();
    const isSettingsOpen = settingsOpen();
    const isHasResult = hasResult();
    const fmtChanged = isFmtOpen !== prevFmtOpen;
    const settingsChanged = isSettingsOpen !== prevSettingsOpen;
    const resultChanged = isHasResult !== prevHasResult;
    prevFmtOpen = isFmtOpen;
    prevSettingsOpen = isSettingsOpen;
    prevHasResult = isHasResult;

    // Toggle → uniform timing; mount/exit (no toggle) → staggered p1/p2.
    const dropdownDur = (settingsChanged || fmtChanged || resultChanged) ? a.dropdown.dur : undefined;
    applyTr(buildTr(a, isLandscape, dropdownDur));
  });
  createEffect(() => { const b = box(); if (!b) return; applyBox(b); });
  createEffect(() => {
    const l = layout; const { vw, vh } = vp();
    const isOpen = fmtOpen();
    const sOpen = settingsOpen();
    const rHas = hasResult();
    if (vw === 0 || vh === 0 || !untrack(box)) return;
    // When dropdown opens, push the video top down by the height of the dropdown content.
    // nItems is always FORMATS.length - 1 (exactly one format is selected/excluded).
    let extraTopPx = 0;
    if (isOpen && !rHas) {
      const nItems = FORMATS.length - 1;
      extraTopPx = 4 + nItems * 20 + (nItems - 1) * 4;
    }
    setBox(computeBox(vw, vh, props.video.width, props.video.height, l, extraTopPx, sOpen, rHas));
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
  createEffect(() => {
    if (!topBarEl) return;
    const show = !hasResult();
    topBarEl.style.opacity       = show ? '1' : '0';
    topBarEl.style.pointerEvents = show ? 'auto' : 'none';
  });

  // Toggle settings panel visibility. The transition (geometry + opacity) is
  // set by applyTr above, so the panel's geometry animates in sync with the
  // bbox. Here we just update the final opacity / pointer-events.
  createEffect(() => {
    const open = settingsOpen();
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
    setIsConverting(true);
    setAppState('converting',  true);
    setAppState('progress',    0);
    setAppState('progressMsg', 'Starting...');
    setResultUrl(null);
    setResultFilename(null);

    const jobId = await startConversion(trimStart(), trimEnd());
    if (!jobId) {
      setIsConverting(false);
      setAppState('converting', false);
      return;
    }

    listenProgress(jobId, (url, filename) => {
      setResultUrl(url);
      setResultFilename(filename);
      setIsConverting(false);
      setAppState('converting', false);
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

    // ── Upload file to server immediately for estimation + conversion ─────────
    if (props.video.file) {
      uploadFile(props.video.file).then(result => {
        if (result) {
          setAppState('uploadJobId',  result.jobId);
          setAppState('currentJobId', result.jobId);
          setAppState('uploadReady',  true);
        }
      });
    } else if (props.video.url && appState.currentJobId) {
      // URL mode: file already on server from /fetch
      setAppState('uploadJobId', appState.currentJobId);
      setAppState('uploadReady', true);
    }

    // ── Video setup ────────────────────────────────────────────────────────────
    videoRef.addEventListener('loadedmetadata', () => {
      const d = videoRef.duration;
      setDuration(d); setTrimStart(0); setTrimEnd(d);
      extractFrames(props.video.objectUrl, d, 20).then(setFrames);
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
      { frames: 18, frameMs: 30, chars: SCRAMBLE_CHARS },
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
    <div ref={containerRef} style={{ position: 'fixed', top: '0', left: '0', right: '0', bottom: '0', background: BG, overflow: 'hidden', '-webkit-app-region': 'drag' } as any}>
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
      `}</style>

      {/* ── Bounding box (video + overlay) ─────────────────────────────────── */}
      <div ref={bboxEl} style={{ position: 'absolute', overflow: 'hidden', '-webkit-app-region': 'no-drag' } as any}>
        {/* Input video — kept mounted across result transitions so playback
            state, refs, and event listeners survive. Faded out in result mode. */}
        <video
          ref={el => { videoRef = el; setVideoEl(el); }}
          src={props.video.objectUrl}
          autoplay muted playsinline
          style={{
            width: '100%', height: '100%', display: 'block', 'object-fit': 'cover',
            opacity: hasResult() ? '0' : '1',
            transition: 'opacity 0.3s ease',
          }}
        />

        {/* Result layer — dotted background + floating processed media.
            Only mounted while a result is present. */}
        <Show when={hasResult()}>
          <div
            style={{
              position: 'absolute', inset: '0',
              'background-image': 'radial-gradient(circle, rgba(252,0,109,0.5) 1px, transparent 1px)',
              'background-size': '32px 32px',
              'background-position': '50% 50%',
              'pointer-events': 'none',
              animation: 'result-fade-in 0.3s ease both',
            } as any}
          />
          <div
            style={{
              position: 'absolute',
              top: `${RESULT_MEDIA_INSET}px`, left: `${RESULT_MEDIA_INSET}px`,
              right: `${RESULT_MEDIA_INSET}px`, bottom: `${RESULT_MEDIA_INSET}px`,
              display: 'flex', 'align-items': 'center', 'justify-content': 'center',
              'pointer-events': 'none',
              animation: 'result-fade-in 0.3s ease both',
            } as any}
          >
            <Show
              when={appState.outputFormat === 'gif'}
              fallback={
                <video
                  src={resultUrl()!}
                  controls autoplay loop playsinline
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
          padding: '24px',
          'pointer-events': 'none',
          'box-sizing': 'border-box',
        }}>
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-start', width: '100%' }}>
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
                    <div title="Settings" style={{ cursor: 'pointer', 'pointer-events': 'auto' }} onClick={() => setSettingsOpen(o => !o)}>
                      <SettingsSvg width={20} height={22} open={settingsOpen()} />
                    </div>
                    <div title="Cancel" style={{ cursor: 'pointer', 'pointer-events': 'auto' }} onClick={triggerExit}>
                      <XSvg width={20} height={22} />
                    </div>
                  </>
                }
              >
                {/* Result state: X alone in top-right. DOWNLOAD chip moved to
                    the bottom-right of the overlay (mirrors Paper design). */}
                <div title="Close result" style={{ cursor: 'pointer', 'pointer-events': 'auto' }} onClick={closeResult}>
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
          <div style={{ position: 'relative', 'align-self': 'stretch' }}>
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
                  gap: '6px',
                  background: ACCENT, color: BG,
                  'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
                  padding: '0 6px',
                  cursor: 'pointer',
                }}
              >
                <span>DOWNLOAD</span>
                {/* Down-arrow glyph — imported from the shared download.svg
                    asset. Fill uses BG so the glyph reads cream on the
                    ACCENT chip; class="download-arrow" hooks the hover
                    bounce keyframe in the <style> block above. */}
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
      <div ref={topBarEl} style={{ position: 'absolute', 'box-sizing': 'border-box', overflow: 'hidden', '-webkit-app-region': 'no-drag' } as any}>
        <FormatPicker
          formats={FORMATS}
          format={format()}
          displayFormat={displayFormat()}
          open={fmtOpen()}
          onToggleOpen={() => setFmtOpen(o => !o)}
          onSelect={(fmt) => { setFormat(fmt); scrambleFormat(fmt); setFmtOpen(false); }}
          onRun={handleRun}
        />
      </div>

      <SettingsColumn ref={el => settingsEl = el} videoEl={videoEl()} open={settingsOpen()} isPortrait={!isLandscape} />

      <Show when={isConverting()}>
        <ConvertingOverlay />
      </Show>

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
