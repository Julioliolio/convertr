import { Component, createEffect, createSignal, onCleanup, onMount, For, Show, untrack } from 'solid-js';
import type { VideoInfo } from '../../App';
import { calculateBBoxTargets } from '../../engine/bbox-calc';
import Timeline from '../controls/Timeline';
import ControlPanel from '../layout/ControlPanel';
import { startConversion } from '../../api/convert';
import { listenProgress } from '../../api/progress';
import { uploadFile } from '../../api/upload';
import { fetchEstimate, cancelEstimate } from '../../api/estimate';
import { appState, setAppState, fps, width, vidWidth, crf } from '../../state/app';
import { ACCENT, ACCENT_75, BG, MONO } from '../../shared/tokens';
import { PlayPauseIcon, XSvg, ArrowSvg, Chip, Cross, FormatButton, CHEVRON_1, CHEVRON_2, MINUS_1, MINUS_2 } from '../../shared/ui';
import LoadingOverlay from '../LoadingOverlay';
import { fmtDuration, fmtBytes, extractFrames } from '../../shared/utils';

// Server-supported formats (lowercase); AVIF not supported server-side
const FORMATS = ['GIF', 'AVIF', 'MP4', 'MOV', 'WEBM', 'MKV'];

const pct = (v: number, of: number) => (v / of * 100).toFixed(4) + '%';

// Space reserved above the video for the top bar (24px pad + 22px btn + 24px bottom margin).
const TOP_BAR_H_PX = 70;
// Closed height of the topBar element — just the button row with no bottom padding.
// Items section sits below this; overflow:hidden clips them until the dropdown opens.
const BTN_ROW_CLOSED_H = 46;

// Space reserved for "VIDEO SETTINGS" label so it never clips off-screen.
// Landscape: label sits below video → reserve vertical space (24px gap + 20px text).
// Portrait:  label sits right of video → reserve horizontal space (24px gap + ~136px text).
const SETTINGS_RESERVE_H = 44;
const SETTINGS_RESERVE_W = 160;

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
}

interface TransitionSet {
  vLines: string; hLines: string; crosses: string;
  bbox: string; topBar: string;
}

// ── Layout computation ─────────────────────────────────────────────────────────
// extraTopPx: additional px to cut from the video top (for open dropdown).
// The video scale/width/bottom are unchanged — only the top shifts down, cropping the video.
function computeBox(vw: number, vh: number, videoW: number, videoH: number, cfg: LayoutCfg, extraTopPx = 0): BoxResult {
  const isLandscape = videoW >= videoH;
  const padH    = vw * cfg.PAD_H;
  const padV    = vh * cfg.PAD_V;
  const topBarH = TOP_BAR_H_PX;
  const availW  = vw - 2 * padH - (isLandscape ? 0 : SETTINGS_RESERVE_W);
  const availH  = vh - 2 * padV - topBarH - (isLandscape ? SETTINGS_RESERVE_H : 0);
  const scale   = Math.min(availW / videoW, availH / videoH);
  const boxW    = videoW * scale;
  const boxH    = videoH * scale;
  const left    = (vw - boxW) / 2;
  // Natural (closed) positions
  const naturalTop    = padV + topBarH + (availH - boxH) / 2;
  const naturalBottom = naturalTop + boxH;
  // Open: top shifts down by extraTopPx, bottom stays fixed → video appears cut from top
  const top    = naturalTop + extraTopPx;
  const bottom = naturalBottom;
  const right  = left + boxW;
  const topBarTop        = naturalTop - topBarH;          // always padV + (availH-boxH)/2
  const effectiveTopBarH = BTN_ROW_CLOSED_H + extraTopPx;  // expands to include dropdown area
  const settingsTop  = isLandscape ? pct(bottom + 24, vh) : pct(top + 24, vh);
  const settingsLeft = isLandscape ? pct(left + 24, vw)  : pct(right + 24, vw);
  return {
    left, top, right, bottom, isLandscape,
    gl: pct(left,  vw), gr: pct(right,  vw),
    gt: pct(top,   vh), gb: pct(bottom, vh),
    topBarTopPct: pct(topBarTop,        vh),
    topBarHPct:   pct(effectiveTopBarH, vh),
    settingsTop, settingsLeft,
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
      const w = width() > 0 ? width() : srcW;
      const h = Math.round(w * srcH / srcW);
      bytes = (w * h * fps() * dur) / 3;
    } else {
      const w = vidWidth() > 0 ? vidWidth() : srcW;
      const h = Math.round(w * srcH / srcW);
      const bpp = 0.07 * Math.pow(2, (23 - crf()) / 6);
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
      fps: fps(), width: appState.outputFormat === 'gif' ? width() : vidWidth(),
      dither: appState.dither, crf: crf(), codec: appState.codec,
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
    appState.outputFormat; fps(); width(); vidWidth(); crf(); appState.dither; appState.codec;
    clearTimeout(estimateTimer);
    if (!ready || !jobId || isDraggingHandle) return;
    estimateTimer = window.setTimeout(runEstimate, 400);
    onCleanup(() => clearTimeout(estimateTimer));
  });

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
  const [format,          setFormat]          = createSignal(FORMATS[0]);
  const [displayFormat,   setDisplayFormat]   = createSignal(FORMATS[0]);

  // ── Format scramble animation ─────────────────────────────────────────────────
  const FORMAT_SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let formatScrambleRaf = 0;
  const scrambleFormat = (target: string) => {
    cancelAnimationFrame(formatScrambleRaf);
    const totalFrames = 14;
    const frameMs = 35;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (now - last < frameMs) { formatScrambleRaf = requestAnimationFrame(tick); return; }
      last = now;
      frame++;
      if (frame >= totalFrames) { setDisplayFormat(target); return; }
      const resolved = Math.floor((frame / totalFrames) * target.length);
      const scrambled = target.split('').map((ch, i) =>
        i < resolved ? ch : FORMAT_SCRAMBLE_CHARS[Math.floor(Math.random() * FORMAT_SCRAMBLE_CHARS.length)]
      ).join('');
      setDisplayFormat(scrambled);
      formatScrambleRaf = requestAnimationFrame(tick);
    };
    formatScrambleRaf = requestAnimationFrame(tick);
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
    settingsEl.style.left = b.settingsLeft;
    settingsEl.style.top  = b.settingsTop;
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
  };

  // ── Effects ───────────────────────────────────────────────────────────────────
  // Transition effect: use dropdown.dur whenever fmtOpen CHANGES (open OR close).
  // Deliberately does NOT read box() so it isn't re-triggered by the box signal
  // updating after fmtOpen changes — which would overwrite the dropdown transition
  // with the regular p1/p2 one before the animation finishes.
  const isLandscape = props.video.width >= props.video.height;
  let prevFmtOpen = false;
  createEffect(() => {
    const a = anim; const isOpen = fmtOpen();
    const changed = isOpen !== prevFmtOpen;
    prevFmtOpen = isOpen;
    applyTr(buildTr(a, isLandscape, changed ? a.dropdown.dur : undefined));
  });
  createEffect(() => { const b = box(); if (!b) return; applyBox(b); });
  createEffect(() => {
    const l = layout; const { vw, vh } = vp();
    const isOpen = fmtOpen();
    if (vw === 0 || vh === 0 || !untrack(box)) return;
    // When dropdown opens, push the video top down by the height of the dropdown content.
    // nItems is always FORMATS.length - 1 (exactly one format is selected/excluded).
    let extraTopPx = 0;
    if (isOpen) {
      const nItems = FORMATS.length - 1;
      extraTopPx = 4 + nItems * 20 + (nItems - 1) * 4;
    }
    setBox(computeBox(vw, vh, props.video.width, props.video.height, l, extraTopPx));
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
        settingsEl.style.transition = `opacity ${fade_dur}s ease ${fade_delay + 0.05}s`;
        settingsEl.style.opacity   = '1';
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
    const a = anim; const b = box();
    if (!b) { props.onBack(); return; }
    const tr = buildTr(a, !b.isLandscape);
    const { fade_dur } = a.timing;
    requestAnimationFrame(() => {
      applyTr(tr);
      topBarEl.style.transition   = tr.topBar + `, opacity ${fade_dur}s ease`;
      settingsEl.style.transition = `opacity ${fade_dur}s ease`;
      void containerRef.getBoundingClientRect();
      snapToIdle();
      topBarEl.style.opacity = '0'; settingsEl.style.opacity = '0';
      const endMs = Math.max(a.timing.p1_dur, a.timing.p2_dur + a.timing.p2_delay, fade_dur) * 1000 + 32;
      setTimeout(() => props.onBack(), endMs);
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

    // ── Wire app state for ControlPanel ───────────────────────────────────────
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

    // ── convertr:run handler ──────────────────────────────────────────────────
    const handleRun = async () => {
      if (isConverting()) return;
      setIsConverting(true);
      setAppState('converting', true);
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
      });
    };
    document.addEventListener('convertr:run', handleRun);
    onCleanup(() => document.removeEventListener('convertr:run', handleRun));

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
      setCurrentTime(videoRef.currentTime);
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
    });
  });

  const crossStyle = { position: 'absolute' as const, width: '20px', height: '20px' };
  const armV = { position: 'absolute' as const, left: '9px', top: '0',  width: '2px', height: '20px', background: ACCENT };
  const armH = { position: 'absolute' as const, left: '0',  top: '9px', width: '20px', height: '2px', background: ACCENT };

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: '0', background: BG, overflow: 'hidden', '-webkit-app-region': 'drag' } as any}>
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
      `}</style>

      {/* ── Bounding box (video + overlay) ─────────────────────────────────── */}
      <div ref={bboxEl} style={{ position: 'absolute', overflow: 'hidden', '-webkit-app-region': 'no-drag' } as any}>
        <video
          ref={videoRef!}
          src={props.video.objectUrl}
          autoplay muted playsinline
          style={{ width: '100%', height: '100%', display: 'block', 'object-fit': 'cover' }}
        />
        {/* Intro loading overlay — covers bbox while video loads */}
        <Show when={showIntroOverlay()}>
          <div style={{ position: 'absolute', inset: '0', overflow: 'hidden', 'z-index': '10' }}>
            <LoadingOverlay
              onDone={() => setShowIntroOverlay(false)}
              delay={850}
            />
          </div>
        </Show>
        {/* Video overlay — padding: 16px (p-4 from Paper) */}
        <div style={{
          position: 'absolute', inset: '0',
          display: 'flex', 'flex-direction': 'column',
          'justify-content': 'space-between',
          padding: '24px',
          'pointer-events': 'none',
          'box-sizing': 'border-box',
        }}>
          {/* Top row: EXPECTED SIZE chips | + cross (center) | → arrow (right) */}
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-start', width: '100%' }}>
            {/* Left: EXPECTED SIZE stacked chips */}
            <div style={{ display: 'flex', 'flex-direction': 'column' }}>
              <Chip>EXPECTED SIZE</Chip>
              <Chip>{displaySize() === '—' ? '—' : `${displaySize()} MB`}</Chip>
            </div>
            {/* Center: + cross */}
            <Cross />
            {/* Right: X close (triggers exit) */}
            <div
              style={{ cursor: 'pointer', 'pointer-events': 'auto' }}
              onClick={triggerExit}
            >
              <XSvg width={20} height={22} />
            </div>
          </div>

          {/* Bottom: play + duration + timeline */}
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'align-self': 'stretch', 'pointer-events': 'auto' }}>
            <div style={{ position: 'relative', height: '16px', 'align-self': 'stretch' }}>
              {/* Play/pause — tracks left trim handle */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(trimStart() / (duration() || 1)) * 100}%`,
                  height: '16px', display: 'flex', 'align-items': 'center',
                  cursor: 'pointer',
                  transition: !dragging() ? 'left 350ms cubic-bezier(1.0,-0.35,0.22,1.15)' : 'none',
                }}
                onClick={togglePlay}
              >
                <PlayPauseIcon playing={isPlaying()} width={16} height={16} />
              </div>
              {/* Duration chip — tracks right trim handle */}
              <div style={{
                position: 'absolute',
                right: `${(1 - trimEnd() / (duration() || 1)) * 100}%`,
                height: '16px', display: 'flex', 'align-items': 'center',
                transition: !dragging() ? 'right 350ms cubic-bezier(1.0,-0.35,0.22,1.15)' : 'none',
              }}>
                <Show when={editingDuration()} fallback={
                  <div onClick={() => { setDraftDuration(String(Math.round(trimmedDuration()))); setEditingDuration(true); }} style={{ cursor: 'text' }}>
                    <Chip size="xs">{fmtDuration(trimmedDuration())}</Chip>
                  </div>
                }>
                  <input
                    ref={el => { durationInputRef = el; setTimeout(() => el.select(), 0); }}
                    type="text"
                    value={draftDuration()}
                    onInput={e => setDraftDuration(e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDuration(); } if (e.key === 'Escape') setEditingDuration(false); }}
                    onBlur={() => setEditingDuration(false)}
                    style={{
                      background: ACCENT, color: BG, border: 'none', outline: 'none',
                      'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
                      width: `${Math.max(draftDuration().length, 2) + 1}ch`,
                      padding: '0', margin: '0', 'caret-color': BG,
                    }}
                  />
                </Show>
              </div>
            </div>
            <Timeline
              duration={duration()}
              trimStart={trimStart()}
              trimEnd={trimEnd()}
              currentTime={currentTime()}
              onTrimChange={handleTrimChange}
              onSeek={handleSeek}
              onHandleDragStart={() => { isDraggingHandle = true; setDragging(true); }}
              onHandleDragEnd={() => { isDraggingHandle = false; setDragging(false); runEstimate(); }}
              frames={frames()}
              smooth={!dragging()}
            />
          </div>
        </div>
      </div>

      {/* ── Top bar area: always the same DOM structure, height animated open/closed ── */}
      {/* Button row stays at a stable position (height = topBarHPx) in both states.
          Format items are always in the DOM — overflow:hidden on the container clips them
          when closed, and the height animation reveals them smoothly when opening.
          This avoids any position jump caused by layout differences between states. */}
      <div ref={topBarEl} style={{ position: 'absolute', 'box-sizing': 'border-box', overflow: 'hidden', '-webkit-app-region': 'no-drag' } as any}>
        {/* ── Button row: 24px padding on all sides, same position open or closed ── */}
        <div style={{
          display: 'flex', 'align-items': 'center', 'justify-content': 'space-between',
          'padding-inline': '24px',
          'padding-top': '24px',
          'padding-bottom': '0px',
          'box-sizing': 'border-box',
          'flex-shrink': '0',
        }}>
          <FormatButton
            format={displayFormat()} open={fmtOpen()} onClick={() => setFmtOpen(o => !o)}
            spring={{ dur: 0.200, x1: 0.006, y1: 0.984, x2: 0.000, y2: 1.109 }}
          />
          <div
            style={{
              cursor: 'pointer', display: 'flex', 'align-items': 'center',
              gap: '4px',
              'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
              color: ACCENT, 'user-select': 'none', 'white-space': 'nowrap',
            }}
            onClick={() => document.dispatchEvent(new CustomEvent('convertr:run'))}
          >
            PROCESS
            <ArrowSvg width={20} height={22} />
          </div>
        </div>
        {/* ── Format items: always in DOM, revealed by overflow:hidden as height grows ── */}
        <div style={{
          'padding-inline': '24px',
          'padding-top': '4px',
          'padding-bottom': '0px',
          display: 'flex', 'flex-direction': 'column',
          gap: '4px',
          'pointer-events': fmtOpen() ? 'auto' : 'none',
        }}>
          <For each={FORMATS.filter(f => f !== format())}>
            {(fmt) => (
              <div
                style={{ 'font-family': MONO, 'font-size': '16px', 'line-height': '20px', color: ACCENT, cursor: 'pointer', 'user-select': 'none' }}
                onClick={() => { setFormat(fmt); scrambleFormat(fmt); setFmtOpen(false); }}
              >
                {fmt}
              </div>
            )}
          </For>
        </div>
      </div>

      {/* ── VIDEO SETTINGS + ControlPanel ──────────────────────────────────── */}
      <div
        ref={settingsEl}
        style={{ position: 'absolute', '-webkit-app-region': 'no-drag', 'min-width': '200px' } as any}
      >
        <span style={{
          'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
          color: ACCENT, 'white-space': 'nowrap', display: 'block', 'margin-bottom': '12px',
        }}>
          VIDEO SETTINGS
        </span>
        <ControlPanel />
      </div>

      {/* ── Converting overlay (animated grid) ────────────────────────────── */}
      <Show when={isConverting()}>
        <div style={{
          position: 'fixed', inset: '0',
          overflow: 'hidden',
          'z-index': '100',
        }}>
          <LoadingOverlay />
          {/* Progress info centered on top of animation */}
          <div style={{
            position: 'absolute', inset: '0',
            display: 'flex', 'flex-direction': 'column',
            'align-items': 'center', 'justify-content': 'center',
            gap: '12px',
            'font-family': MONO,
            'pointer-events': 'none',
          }}>
            <span style={{ background: BG, padding: '2px 6px', color: ACCENT, 'font-size': '12px', 'line-height': '16px' }}>
              {appState.progressMsg || 'Converting...'}
            </span>
            <div style={{ width: '200px', height: '2px', background: 'rgba(252,0,109,0.2)', 'border-radius': '1px' }}>
              <div style={{
                width: `${appState.progress}%`, height: '100%',
                background: ACCENT, transition: 'width 0.3s', 'border-radius': '1px',
              }} />
            </div>
            <span style={{ background: BG, padding: '2px 6px', color: ACCENT, 'font-size': '12px', 'line-height': '16px' }}>
              {Math.round(appState.progress)}%
            </span>
          </div>
        </div>
      </Show>

      {/* ── Result overlay ──────────────────────────────────────────────────── */}
      <Show when={resultUrl()}>
        <div style={{
          position: 'fixed', inset: '0',
          background: BG,
          display: 'flex', 'flex-direction': 'column',
          'align-items': 'center', 'justify-content': 'center',
          gap: '16px',
          'z-index': '100',
        }}>
          <Show when={appState.outputFormat === 'gif'} fallback={
            <video
              src={resultUrl()!}
              controls
              style={{ 'max-width': '80%', 'max-height': '60vh', display: 'block' }}
            />
          }>
            <img
              src={resultUrl()!}
              alt="Result"
              style={{ 'max-width': '80%', 'max-height': '60vh', display: 'block' }}
            />
          </Show>
          <div style={{ display: 'flex', gap: '8px' }}>
            <a
              href={`/download/${appState.currentJobId}`}
              download={resultFilename() || 'output'}
              style={{ 'text-decoration': 'none' }}
            >
              <div style={{
                background: ACCENT, color: BG,
                'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
                padding: '8px 16px', cursor: 'pointer',
              }}>
                DOWNLOAD
              </div>
            </a>
            <div
              style={{
                background: 'transparent', color: ACCENT, border: `1px solid ${ACCENT}`,
                'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
                padding: '8px 16px', cursor: 'pointer', 'box-sizing': 'border-box',
              }}
              onClick={() => { setResultUrl(null); setResultFilename(null); setAppState('progress', 0); }}
            >
              CLOSE
            </div>
          </div>
        </div>
      </Show>

      {/* ── Guide lines ─────────────────────────────────────────────────────── */}
      <div ref={vLineL} style={{ position: 'absolute', top: '0', bottom: '0', width: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={vLineR} style={{ position: 'absolute', top: '0', bottom: '0', width: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={hLineT} style={{ position: 'absolute', left: '0', right: '0', height: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={hLineB} style={{ position: 'absolute', left: '0', right: '0', height: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />

      {/* ── Corner crosshairs ───────────────────────────────────────────────── */}
      <div ref={crossTL} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossTR} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossBL} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossBR} style={crossStyle}><div style={armV} /><div style={armH} /></div>

    </div>
  );
};

export default EditorView;
