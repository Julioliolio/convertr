/**
 * ShimmerBar — terminal-style loading shimmer for the EXPECTED SIZE chip.
 *
 * Loading:  a fixed-width run of █ chars with a bright pulse sweeping L→R.
 * Settling: chars stamp in left-to-right as the value is revealed.
 * Done:     plain value string at full opacity.
 *
 * Tunables (all optional props):
 *   blocks    – number of █ chars shown while loading        (default 8)
 *   cycleMs   – full sweep duration in ms                    (default 700)
 *   settleMs  – total settle/reveal duration in ms           (default 320)
 *   dimAlpha  – opacity of un-lit blocks  0–1               (default 0.22)
 *   pulseHalf – half-width of pulse in chars (softness)      (default 2.2)
 *   sep       – string appended to each block for spacing    (default ' ')
 *   fontSize  – CSS font-size string                         (default '16px')
 *   lineHeight– CSS line-height string                       (default '20px')
 */

import { Component, createEffect, createSignal, Index, onCleanup } from 'solid-js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const BLOCK = '\u2588'; // █ Full Block

/** Alpha [0–1] for block at `charIdx` given pulse centre at `pulsePos`. */
function blockAlpha(
  charIdx: number,
  pulsePos: number,
  pulseHalf: number,
  dimAlpha: number,
): number {
  const dist = Math.abs(charIdx - pulsePos);
  const peak = Math.max(0, 1 - dist / pulseHalf);
  return dimAlpha + peak * (1 - dimAlpha);
}

// ── Types ──────────────────────────────────────────────────────────────────────
type CharItem = { ch: string; alpha: number };

export interface ShimmerBarProps {
  /** True while the estimate is in flight. */
  loading: boolean;
  /** Value to reveal when done (e.g. "57 MB"). */
  value: string;
  /** Number of █ blocks shown during loading. Default 8. */
  blocks?: number;
  /** One full pulse sweep in ms. Default 700. */
  cycleMs?: number;
  /** Total left-to-right reveal time in ms. Default 320. */
  settleMs?: number;
  /** Opacity of un-lit blocks. Default 0.22. */
  dimAlpha?: number;
  /** Pulse softness in chars. Default 2.2. */
  pulseHalf?: number;
  /** String appended to each block char for visual separation. Default ' '. */
  sep?: string;
  /** CSS font-size. Default '16px'. */
  fontSize?: string;
  /** CSS line-height. Default '20px'. */
  lineHeight?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────
export const ShimmerBar: Component<ShimmerBarProps> = (props) => {
  const N          = () => props.blocks    ?? 8;
  const cycleMs    = () => props.cycleMs   ?? 700;
  const settleMs   = () => props.settleMs  ?? 320;
  const dimAlpha   = () => props.dimAlpha  ?? 0.22;
  const pulseHalf  = () => props.pulseHalf ?? 2.2;
  const sep        = () => props.sep       ?? ' ';
  const fontSize   = () => props.fontSize  ?? '16px';
  const lineHeight = () => props.lineHeight ?? '20px';

  const makeBlocks = (n: number): CharItem[] =>
    Array.from({ length: n }, () => ({ ch: BLOCK + sep(), alpha: dimAlpha() }));

  const [chars, setChars] = createSignal<CharItem[]>(makeBlocks(N()));

  let rafId       = 0;
  let settleTimer = 0;
  let t0          = 0;

  const stopAll = () => {
    cancelAnimationFrame(rafId);
    clearTimeout(settleTimer);
  };

  createEffect(() => {
    const loading = props.loading;
    const val     = props.value;
    const n       = N();
    const cycle   = cycleMs();
    const settle  = settleMs();
    const dim     = dimAlpha();
    const half    = pulseHalf();
    const s       = sep();

    stopAll();

    if (loading) {
      // ── Pulse loop ─────────────────────────────────────────────────────────
      t0 = 0;
      const tick = (ts: number) => {
        if (!t0) t0 = ts;
        const phase    = ((ts - t0) % cycle) / cycle;
        // Pulse centre sweeps from -half to n+half so it fully enters/exits.
        const pulsePos = phase * (n + 2 * half) - half;
        setChars(
          Array.from({ length: n }, (_, i) => ({
            ch:    BLOCK + s,
            alpha: blockAlpha(i, pulsePos, half, dim),
          })),
        );
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);

    } else {
      // ── Settle: stamp value chars left-to-right, shrink trailing blocks ────
      //
      // We keep `slots = max(n, val.length)` positions alive initially so
      // the chip can only shrink (never grow) during the reveal.
      // Positions < val.length → get their val char stamped in, then held.
      // Positions ≥ val.length → become '' immediately as they're reached,
      //   collapsing the chip width naturally.
      const slots  = Math.max(n, val.length);
      const stepMs = settle / Math.max(val.length, 1);

      // Seed with blocks (or empty for any positions that were already > n)
      setChars(
        Array.from({ length: slots }, (_, i) => ({
          ch:    i < n ? BLOCK + s : '',
          alpha: dim,
        })),
      );

      let revealed = 0;

      const step = () => {
        if (revealed < slots) {
          const idx = revealed++;
          setChars(prev => {
            const next = prev.slice();
            next[idx] = {
              ch:    idx < val.length ? val[idx] : '',
              alpha: 1,
            };
            // Prune trailing empty slots so chip width tracks naturally
            let end = next.length;
            while (end > 0 && next[end - 1].ch === '') end--;
            return next.slice(0, end);
          });
          settleTimer = window.setTimeout(step, stepMs);
        } else {
          // Final: exact value, all fully opaque
          setChars(Array.from(val, (ch) => ({ ch, alpha: 1 })));
        }
      };

      step(); // first char stamps immediately (no initial delay)
    }

    onCleanup(stopAll);
  });

  return (
    <span
      style={{
        display:       'inline-block',
        'font-family':  "'IBM Plex Mono', system-ui, monospace",
        'font-size':    fontSize(),
        'line-height':  lineHeight(),
        'white-space': 'nowrap',
      }}
    >
      <Index each={chars()}>
        {(char) => (
          <span style={{ color: `rgba(252,0,109,${char().alpha.toFixed(3)})` }}>
            {char().ch}
          </span>
        )}
      </Index>
    </span>
  );
};
