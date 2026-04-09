import { Component, Show, createSignal, For } from 'solid-js';
import IdleView from './components/views/IdleView';
import EditorView from './components/views/EditorView';
import PlaygroundView from './components/views/PlaygroundView';

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
type DevTab = 'app' | 'playground' | 'dropdown';

const DevBar: Component<{ active: DevTab; onChange: (t: DevTab) => void }> = (p) => {
  const tabs: { id: DevTab; label: string }[] = [
    { id: 'app',        label: 'app' },
    { id: 'playground', label: 'playground' },
    { id: 'dropdown',   label: 'dropdown' },
  ];
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
        <button
          onClick={() => p.onChange(t.id)}
          style={{
            background: p.active === t.id ? '#FC006D' : 'transparent',
            color:      p.active === t.id ? '#fff'    : '#666',
            border: 'none', cursor: 'pointer',
            padding: '4px 10px',
            'font-family': 'inherit', 'font-size': 'inherit',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
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

const Slider: Component<{ label: string; value: number; min: number; max: number; onChange: (v: number) => void }> = (p) => (
  <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-family': MONO, 'font-size': '11px', color: '#555' }}>
    <span style={{ width: '140px', 'flex-shrink': '0' }}>{p.label}</span>
    <input type="range" min={p.min} max={p.max} value={p.value}
      onInput={e => p.onChange(Number(e.currentTarget.value))}
      style={{ width: '100px' }} />
    <span style={{ width: '28px', 'text-align': 'right', color: ACCENT }}>{p.value}</span>
  </div>
);

// VIDEO_MARGIN = space reserved for the video top margin (independent of dropdown gap)
const VIDEO_MARGIN = 24;
const BTN_ROW_ONLY_H = BTN_PAD_TOP + BTN_CONTENT_H; // 46px — closed height without bottom pad

const DropdownTest: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [fmt,  setFmt]  = createSignal('GIF');

  // Live-tunable values — tweak these, then copy finals to EditorView
  const [btnPadTop,   setBtnPadTop]   = createSignal(BTN_PAD_TOP);
  const [itemsPadTop, setItemsPadTop] = createSignal(4);
  const [itemsPadBot, setItemsPadBot] = createSignal(0);
  const [itemGap,     setItemGap]     = createSignal(4);

  // Closed height = just the button row (no bottom padding) — items are clipped
  const closedH  = () => btnPadTop() + BTN_CONTENT_H;
  const itemsH   = () => itemsPadTop() + N_ITEMS * ITEM_H + (N_ITEMS - 1) * itemGap() + itemsPadBot();
  const openH    = () => closedH() + itemsH();

  return (
    <div style={{
      position: 'fixed', inset: '0', background: BG,
      display: 'flex', 'align-items': 'flex-start', 'justify-content': 'flex-start',
      padding: '40px',
    }}>
      {/* Video edge marker — shows where the bounding box top edge would be */}
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
          <div style={{ position: 'relative', display: 'inline-flex', 'align-items': 'center', gap: '3px', padding: '2px', cursor: 'pointer', 'user-select': 'none' }}
            onClick={() => setOpen(o => !o)}>
            <div style={{ position: 'absolute', inset: '0', background: ACCENT, 'clip-path': open() ? 'inset(0 0 0 0%)' : 'inset(0 0 0 calc(100% - 18px))', transition: 'clip-path 150ms ease', 'pointer-events': 'none' }} />
            <span style={{ position: 'relative', 'z-index': '1', color: open() ? BG : ACCENT, 'font-family': MONO, 'font-size': '16px', 'line-height': '16px', 'flex-shrink': '0', transition: 'color 150ms ease' }}>{fmt()}</span>
            <span style={{ position: 'relative', 'z-index': '1', color: BG, 'font-family': MONO, 'font-size': '14px', 'line-height': '16px', width: '16px', height: '16px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'flex-shrink': '0' }}>{open() ? '−' : '>'}</span>
          </div>
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
      <div style={{ position: 'fixed', top: '40px', right: '40px', display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
        <Slider label="btn pad top"    value={btnPadTop()}   min={0} max={40} onChange={setBtnPadTop} />
        <Slider label="items pad top"  value={itemsPadTop()} min={0} max={40} onChange={setItemsPadTop} />
        <Slider label="items pad bot"  value={itemsPadBot()} min={0} max={40} onChange={setItemsPadBot} />
        <Slider label="item gap"       value={itemGap()}     min={0} max={32} onChange={setItemGap} />
        <div style={{ 'font-family': MONO, 'font-size': '10px', color: '#aaa', 'margin-top': '8px', 'line-height': '16px' }}>
          <div>closed H = {closedH()}px  (video margin = {VIDEO_MARGIN}px fixed)</div>
          <div>open H   = {openH()}px</div>
        </div>
      </div>
    </div>
  );
};

// ── App ───────────────────────────────────────────────────────────────────────
const App: Component = () => {
  const [devTab, setDevTab] = createSignal<DevTab>('dropdown');
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
        <PlaygroundView />
      </Show>
      <Show when={devTab() === 'dropdown'}>
        <DropdownTest />
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
        <DevBar active={devTab()} onChange={setDevTab} />
      </Show>
    </>
  );
};

export default App;
