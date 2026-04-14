import { Component, Show, createSignal, For, onCleanup } from 'solid-js';
import IdleView from './components/views/IdleView';
import EditorView from './components/views/EditorView';
import PlaygroundView from './components/views/PlaygroundView';
import SliderPlayground from './components/views/SliderPlayground';
import LoadingPlayground from './components/views/LoadingPlayground';
import DottedBgPlayground from './components/views/DottedBgPlayground';
import CanvasPlayground from './components/views/CanvasPlayground';
import { FormatButton } from './shared/ui';

export interface VideoInfo {
  file?: File;
  url?: string;
  name: string;
  sizeBytes: number;
  width: number;
  height: number;
  objectUrl: string;
}

import { ACCENT, BG, MONO } from './shared/tokens';

const IS_DEV = import.meta.env.DEV;

const FORMATS = ['GIF', 'AVIF', 'MP4', 'MOV', 'WEBM', 'MKV'];

// ── Dev tab bar ───────────────────────────────────────────────────────────────
type DevTab = 'app' | 'playground';
type PlaygroundTab = 'video' | 'dropdown' | 'slider' | 'loading' | 'dotted-bg' | 'canvas';

const PLAYGROUND_TABS: { id: PlaygroundTab; label: string }[] = [
  { id: 'video',     label: 'video' },
  { id: 'dropdown',  label: 'dropdown' },
  { id: 'slider',    label: 'slider' },
  { id: 'loading',   label: 'loading' },
  { id: 'dotted-bg', label: 'dotted bg' },
  { id: 'canvas',    label: 'canvas' },
];

const DevBar: Component<{
  active: DevTab;
  onChange: (t: DevTab) => void;
  playgroundTab: PlaygroundTab;
  onPlaygroundTab: (t: PlaygroundTab) => void;
}> = (p) => {
  const tabs: { id: DevTab; label: string }[] = [
    { id: 'app',        label: 'app' },
    { id: 'playground', label: 'playground' },
  ];

  const btnStyle = (active: boolean) => ({
    background: active ? ACCENT : 'transparent',
    color:      active ? '#fff'    : '#666',
    border: 'none', cursor: 'pointer',
    padding: '4px 10px',
    'font-family': 'inherit', 'font-size': 'inherit',
    transition: 'background 0.15s, color 0.15s',
  });

  return (
    <div style={{
      position: 'fixed', bottom: '0', left: '0', right: '0',
      display: 'flex', 'align-items': 'center', gap: '1px',
      background: '#111', 'z-index': '9999',
      'font-family': "'IBM Plex Mono', monospace",
      'font-size': '11px',
      'border-top': '1px solid #333',
    }}>
      <span style={{ color: '#555', padding: '4px 8px', 'flex-shrink': '0' }}>dev</span>
      {tabs.map(t => (
        <button onClick={() => p.onChange(t.id)} style={btnStyle(p.active === t.id)}>
          {t.label}
        </button>
      ))}

      <Show when={p.active === 'playground'}>
        <span style={{ color: '#333', padding: '4px 4px', 'flex-shrink': '0' }}>|</span>
        {PLAYGROUND_TABS.map(t => (
          <button onClick={() => p.onPlaygroundTab(t.id)} style={btnStyle(p.playgroundTab === t.id)}>
            {t.label}
          </button>
        ))}
      </Show>
    </div>
  );
};

// ── Dropdown test ─────────────────────────────────────────────────────────────
// Tweak these constants until the open/closed states match the reference images,
// then copy the final values back to EditorView.tsx.
const BTN_PAD_TOP    = 24;  // button row top padding
const BTN_PAD_BOT    = 0;   // button row bottom padding
const BTN_CONTENT_H  = 22;  // tallest button (XSvg = 22px)
const BTN_ROW_H      = BTN_PAD_TOP + BTN_CONTENT_H + BTN_PAD_BOT; // = 46
const ITEMS_PAD_TOP  = 12;  // gap between button row and first item (same as ITEM_GAP)
const ITEMS_PAD_BOT  = 0;   // padding below last item (gap to video provides the 24px margin)
const ITEM_H         = 20;  // line-height of each format item
const ITEM_GAP       = 12;  // gap between items
const N_ITEMS        = FORMATS.length - 1; // 5 (one format is selected/excluded)
const ITEMS_H        = ITEMS_PAD_TOP + N_ITEMS * ITEM_H + (N_ITEMS - 1) * ITEM_GAP + ITEMS_PAD_BOT;

const Slider: Component<{ label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }> = (p) => (
  <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-family': MONO, 'font-size': '11px', color: '#555' }}>
    <span style={{ width: '90px', 'flex-shrink': '0' }}>{p.label}</span>
    <input type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value}
      onInput={e => p.onChange(Number(e.currentTarget.value))}
      style={{ width: '100px' }} />
    <span style={{ width: '36px', 'text-align': 'right', color: ACCENT }}>{p.value}</span>
  </div>
);

// ── Bezier curve editor ────────────────────────────────────────────────────────
const EASING_PRESETS = [
  { label: 'linear',      x1: 0,    y1: 0,    x2: 1,    y2: 1    },
  { label: 'ease',        x1: 0.25, y1: 0.1,  x2: 0.25, y2: 1    },
  { label: 'ease-in',     x1: 0.42, y1: 0,    x2: 1,    y2: 1    },
  { label: 'ease-out',    x1: 0,    y1: 0,    x2: 0.58, y2: 1    },
  { label: 'ease-in-out', x1: 0.42, y1: 0,    x2: 0.58, y2: 1    },
  { label: 'spring',      x1: 0.34, y1: 1.56, x2: 0.64, y2: 1    },
];

const BezierEditor: Component<{
  x1: number; y1: number; x2: number; y2: number;
  onChange: (x1: number, y1: number, x2: number, y2: number) => void;
}> = (p) => {
  const S = 160, PAD = 20, TOTAL = S + PAD * 2;

  // Map bezier coords → SVG coords (bezier: y=0 bottom, SVG: y=0 top)
  const bx = (v: number) => PAD + v * S;
  const by = (v: number) => PAD + (1 - v) * S;

  // Map SVG coords → bezier coords
  const fromSvg = (sx: number, sy: number) => [
    Math.max(0, Math.min(1, (sx - PAD) / S)),  // x clamped to [0,1]
    (PAD + S - sy) / S,                          // y unrestricted (allows overshoot)
  ] as const;

  let svgEl: SVGSVGElement | undefined;
  let dragging: 1 | 2 | null = null;

  const getSvgPos = (e: MouseEvent) => {
    const r = svgEl!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * TOTAL, (e.clientY - r.top) / r.height * TOTAL] as const;
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const [sx, sy] = getSvgPos(e);
    const [x, y] = fromSvg(sx, sy);
    if (dragging === 1) p.onChange(x, y, p.x2, p.y2);
    else                p.onChange(p.x1, p.y1, x, y);
  };
  const onUp = () => {
    dragging = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  const startDrag = (handle: 1 | 2) => (e: MouseEvent) => {
    e.preventDefault();
    dragging = handle;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  onCleanup(() => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); });

  const curve = () => `M ${bx(0)} ${by(0)} C ${bx(p.x1)} ${by(p.y1)} ${bx(p.x2)} ${by(p.y2)} ${bx(1)} ${by(1)}`;

  const GRID = [0.25, 0.5, 0.75];

  return (
    <svg ref={svgEl!} width={TOTAL} height={TOTAL} style={{ display: 'block', 'user-select': 'none' }}>
      {/* Background */}
      <rect x={PAD} y={PAD} width={S} height={S} fill="#0a0a0a" stroke="#222" stroke-width="1" />
      {/* Grid */}
      {GRID.map(t => <>
        <line x1={bx(t)} y1={PAD} x2={bx(t)} y2={PAD + S} stroke="#1a1a1a" stroke-width="1" />
        <line x1={PAD} y1={by(t)} x2={PAD + S} y2={by(t)} stroke="#1a1a1a" stroke-width="1" />
      </>)}
      {/* Diagonal reference */}
      <line x1={bx(0)} y1={by(0)} x2={bx(1)} y2={by(1)} stroke="#2a2a2a" stroke-width="1" stroke-dasharray="3 3" />
      {/* Control arms */}
      <line x1={bx(0)} y1={by(0)} x2={bx(p.x1)} y2={by(p.y1)} stroke="#3a3a3a" stroke-width="1" />
      <line x1={bx(1)} y1={by(1)} x2={bx(p.x2)} y2={by(p.y2)} stroke="#3a3a3a" stroke-width="1" />
      {/* Curve */}
      <path d={curve()} fill="none" stroke={ACCENT} stroke-width="2" stroke-linecap="round" />
      {/* Anchor points */}
      <circle cx={bx(0)} cy={by(0)} r={3} fill="#444" />
      <circle cx={bx(1)} cy={by(1)} r={3} fill="#444" />
      {/* Handles */}
      <circle cx={bx(p.x1)} cy={by(p.y1)} r={5} fill={ACCENT} style={{ cursor: 'grab' }} onMouseDown={startDrag(1)} />
      <circle cx={bx(p.x2)} cy={by(p.y2)} r={5} fill={ACCENT} style={{ cursor: 'grab' }} onMouseDown={startDrag(2)} />
    </svg>
  );
};

// VIDEO_MARGIN = space reserved for the video top margin (independent of dropdown gap)
const VIDEO_MARGIN = 24;
const BTN_ROW_ONLY_H = BTN_PAD_TOP + BTN_CONTENT_H; // 46px — closed height without bottom pad

const DropdownTest: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [fmt,  setFmt]  = createSignal('GIF');

  // Live-tunable spacing values
  const [btnPadTop,   setBtnPadTop]   = createSignal(BTN_PAD_TOP);
  const [itemsPadTop, setItemsPadTop] = createSignal(4);
  const [itemsPadBot, setItemsPadBot] = createSignal(0);
  const [itemGap,     setItemGap]     = createSignal(4);

  // Animation curve + duration
  const [cx1, setCx1] = createSignal(0.25);
  const [cy1, setCy1] = createSignal(0.1);
  const [cx2, setCx2] = createSignal(0.25);
  const [cy2, setCy2] = createSignal(1);
  const [dur, setDur] = createSignal(300);

  const easing = () => `cubic-bezier(${cx1().toFixed(3)}, ${cy1().toFixed(3)}, ${cx2().toFixed(3)}, ${cy2().toFixed(3)})`;
  const btnTransition = () => `${dur()}ms ${easing()}`;

  // Closed height = just the button row (no bottom padding) — items are clipped
  const closedH = () => btnPadTop() + BTN_CONTENT_H;
  const itemsH  = () => itemsPadTop() + N_ITEMS * ITEM_H + (N_ITEMS - 1) * itemGap() + itemsPadBot();
  const openH   = () => closedH() + itemsH();

  const applyPreset = (p: typeof EASING_PRESETS[0]) => {
    setCx1(p.x1); setCy1(p.y1); setCx2(p.x2); setCy2(p.y2);
  };

  const [applyState, setApplyState] = createSignal<'idle' | 'ok' | 'err'>('idle');
  const applyToApp = () => {
    const text = `highlight: { dur: ${(dur() / 1000).toFixed(3)}, x1: ${cx1().toFixed(3)}, y1: ${cy1().toFixed(3)}, x2: ${cx2().toFixed(3)}, y2: ${cy2().toFixed(3)} }`;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setApplyState('ok');
    } catch { setApplyState('err'); }
    setTimeout(() => setApplyState('idle'), 2500);
  };

  return (
    <div style={{
      position: 'fixed', inset: '0', background: BG,
      display: 'flex', 'align-items': 'flex-start', 'justify-content': 'flex-start',
      padding: '40px',
    }}>
      {/* Video edge marker */}
      <div style={{
        position: 'absolute',
        top: `${40 + btnPadTop() + BTN_CONTENT_H + VIDEO_MARGIN}px`,
        left: '0', right: '0',
        height: '1px', background: 'rgba(252,0,109,0.25)',
        'pointer-events': 'none',
      }} />

      {/* Dropdown */}
      <div style={{
        width: '200px', overflow: 'hidden',
        height: `${open() ? openH() : closedH()}px`,
        transition: 'height 0.3s ease',
      }}>
        <div style={{
          display: 'flex', 'align-items': 'center', 'justify-content': 'space-between',
          'padding-inline': '24px',
          'padding-top': `${btnPadTop()}px`,
          'padding-bottom': '0px',
          'box-sizing': 'border-box', 'flex-shrink': '0',
        }}>
          <FormatButton
            format={fmt()} open={open()} onClick={() => setOpen(o => !o)}
            spring={{ dur: dur() / 1000, x1: cx1(), y1: cy1(), x2: cx2(), y2: cy2() }}
          />
          <svg width={20} height={22} viewBox="0 0 79 88" fill="none" style={{ 'flex-shrink': '0' }}>
            <rect width="78.198" height="87.165" fill={ACCENT} />
            <rect width="55" height="6" transform="matrix(0.643 -0.766 -0.766 -0.643 23.721 66.577)" fill="#FFFFFF" />
            <rect width="55" height="6" transform="matrix(-0.643 -0.766 -0.766 0.643 59.074 62.721)" fill="#FFFFFF" />
          </svg>
        </div>
        <div style={{ 'padding-inline': '24px', 'padding-top': `${itemsPadTop()}px`, 'padding-bottom': `${itemsPadBot()}px`, display: 'flex', 'flex-direction': 'column', gap: `${itemGap()}px` }}>
          <For each={FORMATS.filter(f => f !== fmt())}>
            {(f) => (
              <div style={{ 'font-family': MONO, 'font-size': '16px', 'line-height': `${ITEM_H}px`, color: ACCENT, cursor: 'pointer', 'user-select': 'none' }}
                onClick={() => { setFmt(f); setOpen(false); }}>{f}</div>
            )}
          </For>
        </div>
      </div>

      {/* ── Controls ── */}
      <div style={{ position: 'fixed', top: '40px', right: '40px', display: 'flex', 'flex-direction': 'column', gap: '16px', 'font-family': MONO }}>

        {/* Spacing */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>SPACING</div>
          <Slider label="btn pad top"   value={btnPadTop()}   min={0} max={40} onChange={setBtnPadTop} />
          <Slider label="items pad top" value={itemsPadTop()} min={0} max={40} onChange={setItemsPadTop} />
          <Slider label="items pad bot" value={itemsPadBot()} min={0} max={40} onChange={setItemsPadBot} />
          <Slider label="item gap"      value={itemGap()}     min={0} max={32} onChange={setItemGap} />
          <div style={{ 'font-size': '10px', color: '#333', 'line-height': '16px', 'margin-top': '2px' }}>
            <div>closed {closedH()}px · open {openH()}px · margin {VIDEO_MARGIN}px</div>
          </div>
        </div>

        {/* Animation */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em' }}>ANIMATION</div>

          {/* Presets */}
          <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px' }}>
            <For each={EASING_PRESETS}>
              {(pr) => (
                <button
                  onClick={() => applyPreset(pr)}
                  style={{
                    background: 'transparent', border: '1px solid #2a2a2a',
                    color: '#555', cursor: 'pointer', padding: '2px 6px',
                    'font-family': MONO, 'font-size': '10px',
                    transition: 'border-color 0.1s, color 0.1s',
                  }}
                  onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = ACCENT; (e.target as HTMLElement).style.color = ACCENT; }}
                  onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = '#2a2a2a'; (e.target as HTMLElement).style.color = '#555'; }}
                >
                  {pr.label}
                </button>
              )}
            </For>
          </div>

          {/* Bezier graph */}
          <BezierEditor
            x1={cx1()} y1={cy1()} x2={cx2()} y2={cy2()}
            onChange={(x1, y1, x2, y2) => { setCx1(x1); setCy1(y1); setCx2(x2); setCy2(y2); }}
          />

          {/* Duration */}
          <Slider label="duration ms" value={dur()} min={50} max={1000} step={10} onChange={setDur} />

          {/* Output */}
          <div style={{ 'font-size': '9px', color: '#333', 'line-height': '15px', 'word-break': 'break-all' }}>
            clip-path {btnTransition()}
          </div>

          {/* Apply */}
          <button
            onClick={applyToApp}
            style={{
              background: applyState() === 'ok' ? '#1a3a1a' : applyState() === 'err' ? '#3a1a1a' : ACCENT,
              color: applyState() === 'ok' ? '#5f5' : applyState() === 'err' ? '#f55' : '#fff',
              border: 'none', cursor: 'pointer',
              padding: '5px 12px', 'margin-top': '4px',
              'font-family': MONO, 'font-size': '11px',
              transition: 'background 0.2s, color 0.2s',
              'align-self': 'flex-start',
            }}
          >
            {applyState() === 'ok' ? 'copied ✓' : applyState() === 'err' ? 'error ✗' : 'copy values'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── App ───────────────────────────────────────────────────────────────────────
const App: Component = () => {
  const [devTab, setDevTab] = createSignal<DevTab>(IS_DEV ? 'playground' : 'app');
  const [pgTab, setPgTab] = createSignal<PlaygroundTab>('canvas');
  const [view, setView] = createSignal<'idle' | 'editor'>('idle');
  const [video, setVideo] = createSignal<VideoInfo | null>(null);
  const handleVideoSelected = (info: VideoInfo) => {
    setVideo(info);
    setView('editor');
  };

  const handleBack = () => {
    const v = video();
    if (v?.objectUrl) URL.revokeObjectURL(v.objectUrl);
    setVideo(null);
    setView('idle');
  };

  return (
    <>
      <Show when={devTab() === 'playground'}>
        <Show when={pgTab() === 'video'}>
          <PlaygroundView />
        </Show>
        <Show when={pgTab() === 'dropdown'}>
          <DropdownTest />
        </Show>
        <Show when={pgTab() === 'slider'}>
          <SliderPlayground />
        </Show>
        <Show when={pgTab() === 'loading'}>
          <LoadingPlayground />
        </Show>
        <Show when={pgTab() === 'dotted-bg'}>
          <DottedBgPlayground />
        </Show>
        <Show when={pgTab() === 'canvas'}>
          <CanvasPlayground />
        </Show>
      </Show>
      <Show when={!IS_DEV || devTab() === 'app'}>
        <Show
          when={view() === 'editor' && video()}
          fallback={<IdleView onVideoSelected={handleVideoSelected} />}
        >
          {(v) => <EditorView video={v()} onBack={handleBack} />}
        </Show>
      </Show>
      <Show when={IS_DEV}>
        <DevBar
          active={devTab()} onChange={setDevTab}
          playgroundTab={pgTab()} onPlaygroundTab={setPgTab}
        />
      </Show>
    </>
  );
};

export default App;
