import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { ACCENT, BG, MONO } from '../../../shared/tokens';
import { BAR_HEIGHT, formatBytes, formatEta, type BarProps } from './common';

// Image-1 "Control Matrix" mini-dashboard packed inside the loading bar:
//   [ progress rail ] | [ NET STATUS / CODEC LOG scroll ]

// Upload-phase flavor feed — bytes RX log.
const UPLOAD_POOL = [
  { kind: 'ok',      src: '44.95.170.217' },
  { kind: 'ok',      src: '92.128.192.215' },
  { kind: 'ok',      src: '226.110.235.116' },
  { kind: 'chunk',   src: '184.245.81.26' },
  { kind: 'chunk',   src: '216.120.108.67' },
  { kind: 'retry',   src: '147.198.14.41' },
  { kind: 'ok',      src: '218.75.241.233' },
  { kind: 'chunk',   src: '235.40.176.220' },
] as const;

// Process-phase feed — frame / codec log.
const PROCESS_POOL = [
  { kind: 'frame' },
  { kind: 'keyframe' },
  { kind: 'frame' },
  { kind: 'gop' },
  { kind: 'frame' },
  { kind: 'bitrate' },
  { kind: 'frame' },
  { kind: 'frame' },
] as const;

const ControlMatrix: Component<BarProps> = (p) => {
  const h = () => p.height ?? BAR_HEIGHT;
  const [feed, setFeed] = createSignal<number[]>([0, 1, 2]);

  let feedTimer: number | undefined;

  onMount(() => {
    feedTimer = window.setInterval(() => {
      const poolLen = (p.telemetry?.phase === 'process' ? PROCESS_POOL : UPLOAD_POOL).length;
      setFeed(prev => [
        (prev[0] + 1) % poolLen,
        (prev[1] + 1) % poolLen,
        (prev[2] + 1) % poolLen,
      ]);
    }, 280);
  });
  onCleanup(() => {
    if (feedTimer) clearInterval(feedTimer);
  });

  const railLabel = () => {
    if (!p.telemetry) return 'TRANSCODING';
    return p.telemetry.phase === 'upload' ? 'UPLOADING' : 'TRANSCODING';
  };

  const pct = () => Math.round(p.progress);

  const footerCenter = () => {
    const t = p.telemetry;
    if (!t) return `PKT:${57710 + Math.floor(p.progress * 10)}`;
    if (t.phase === 'upload') {
      const done = t.bytesDone ?? 0;
      const total = t.bytesTotal ?? 0;
      return `${formatBytes(done)} / ${formatBytes(total)}`;
    }
    return `FRAMES:${t.framesDone ?? 0}/${t.framesTotal ?? 0}`;
  };

  const footerRight = () => {
    const t = p.telemetry;
    if (!t) return `CARRIER:${(118.9 - p.progress * 0.04).toFixed(1)}km`;
    if (t.phase === 'upload') {
      // Throughput derived from bytes/elapsed
      const mb = ((t.bytesDone ?? 0) / 1024 / 1024);
      const sec = Math.max(0.001, t.elapsedMs / 1000);
      return `${(mb / sec).toFixed(1)}MB/s`;
    }
    return `${(t.fps ?? 0).toFixed(0)}fps · ${(t.bitrateKbps ?? 0).toFixed(0)}kb/s`;
  };

  const footerLeft = () => {
    const t = p.telemetry;
    if (!t) return `LAT:${(4 + (p.progress % 7)).toFixed(1)}ms`;
    if (t.phase === 'upload') return `LAT:${(4 + (p.progress % 7)).toFixed(1)}ms`;
    return `ETA ${formatEta(t.etaMs ?? 0)} · ${(t.speedX ?? 1).toFixed(2)}x`;
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${h()}px`,
        outline: `1px solid ${ACCENT}`,
        background: BG,
        display: 'grid',
        'grid-template-columns': '1fr 260px',
        'font-family': MONO,
        color: ACCENT,
        'font-size': '11px',
        'line-height': '14px',
        overflow: 'hidden',
      }}
    >
      {/* Progress rail + ticker */}
      <div style={{ position: 'relative', padding: '8px 14px', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', gap: '6px' }}>
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '9px', opacity: '0.7', 'letter-spacing': '0.08em' }}>
          <span>{railLabel()}</span>
          <span style={{ 'font-variant-numeric': 'tabular-nums' }}>{pct()}% · MEM:77% · CPU:{p.telemetry?.phase === 'process' ? '84' : '20'}%</span>
        </div>
        <div style={{ position: 'relative', height: '14px', border: `1px solid ${ACCENT}` }}>
          <div style={{
            position: 'absolute', top: '0', bottom: '0', left: '0',
            width: `${p.progress}%`,
            background: ACCENT,
            transition: 'width 160ms linear',
          }} />
          {/* Tick marks every 10% */}
          <For each={[10,20,30,40,50,60,70,80,90]}>{t => (
            <div style={{
              position: 'absolute', top: '0', bottom: '0',
              left: `${t}%`,
              width: '1px',
              background: p.progress > t ? BG : 'rgba(252,0,109,0.3)',
            }} />
          )}</For>
        </div>
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '9px', opacity: '0.55', 'font-variant-numeric': 'tabular-nums' }}>
          <span>{footerLeft()}</span>
          <span>{footerCenter()}</span>
          <span>{footerRight()}</span>
        </div>
      </div>

      {/* NET STATUS scroller */}
      <div style={{ 'border-left': `1px solid rgba(252,0,109,0.25)`, padding: '8px 10px', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', gap: '1px', overflow: 'hidden' }}>
        <div style={{ 'font-size': '9px', opacity: '0.55', 'letter-spacing': '0.08em', 'margin-bottom': '1px' }}>
          {p.telemetry?.phase === 'process' ? 'CODEC LOG' : 'NET STATUS'}
        </div>
        <For each={feed()}>{idx => (
          <Show
            when={p.telemetry?.phase === 'process'}
            fallback={<UploadLine idx={idx} bytesDone={p.telemetry?.bytesDone ?? 0} />}
          >
            <ProcessLine idx={idx} framesDone={p.telemetry?.framesDone ?? 0} bitrateKbps={p.telemetry?.bitrateKbps ?? 0} />
          </Show>
        )}</For>
      </div>
    </div>
  );
};

// ── Feed-line subcomponents ─────────────────────────────────────────────────
// Split into their own components so Solid rebuilds the subtree when `phase`
// flips (the outer For keeps items keyed by feed-index; a bare branch inside
// the callback leaks stale upload lines into the process phase).

const UploadLine: Component<{ idx: number; bytesDone: number }> = (p) => {
  const s = () => UPLOAD_POOL[p.idx];
  const chunk = () => p.bytesDone + p.idx * 4096;
  return (
    <div style={{
      background: s().kind === 'retry' ? ACCENT : 'transparent',
      color: s().kind === 'retry' ? BG : ACCENT,
      padding: '0 3px',
      'white-space': 'nowrap',
      overflow: 'hidden',
      'text-overflow': 'clip',
      'font-size': '11px',
    }}>
      <Show when={s().kind === 'ok'}>RX <span style={{ opacity: '0.7' }}>{formatBytes(chunk())}</span> {s().src} OK</Show>
      <Show when={s().kind === 'chunk'}>RX <span style={{ opacity: '0.7' }}>chunk {p.idx}</span> {s().src}</Show>
      <Show when={s().kind === 'retry'}>{s().src} TIMEOUT retry=</Show>
    </div>
  );
};

const ProcessLine: Component<{ idx: number; framesDone: number; bitrateKbps: number }> = (p) => {
  const s = () => PROCESS_POOL[p.idx];
  const frames = () => p.framesDone - p.idx * 7;
  return (
    <Show when={s().kind === 'keyframe'} fallback={
      <Show when={s().kind === 'gop'} fallback={
        <Show when={s().kind === 'bitrate'} fallback={
          <div style={{ padding: '0 3px', 'white-space': 'nowrap', 'font-size': '11px' }}>
            <span style={{ opacity: '0.7' }}>f={frames()}</span> B-slice · enc ok
          </div>
        }>
          <div style={{ padding: '0 3px', 'white-space': 'nowrap', 'font-size': '11px' }}>
            vbv {Math.floor(p.bitrateKbps)}kb/s · qp=22
          </div>
        </Show>
      }>
        <div style={{ padding: '0 3px', 'white-space': 'nowrap', 'font-size': '11px' }}>
          GOP close · poc={frames() % 250}
        </div>
      </Show>
    }>
      <div style={{ background: ACCENT, color: BG, padding: '0 3px', 'white-space': 'nowrap', 'font-size': '11px' }}>
        IDR KEYFRAME f={frames()}
      </div>
    </Show>
  );
};

export default ControlMatrix;
