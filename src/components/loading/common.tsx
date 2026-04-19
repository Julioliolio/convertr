import type { Component } from 'solid-js';

// ── Telemetry ─────────────────────────────────────────────────────────────
// Real-feeling numbers the full-flow demo pipes into data-heavy variants
// (notably ControlMatrix). Variants that don't care about telemetry simply
// ignore the field — the only thing they all must honor is `progress`.

export interface BarTelemetry {
  phase: 'upload' | 'process';
  elapsedMs: number;
  // Upload phase
  bytesDone?: number;
  bytesTotal?: number;
  // Process phase
  framesDone?: number;
  framesTotal?: number;
  fps?: number;
  bitrateKbps?: number;
  etaMs?: number;
  speedX?: number;
}

export interface BarProps {
  progress: number;
  height?: number;
  telemetry?: BarTelemetry;
}

export type BarVariantComponent = Component<BarProps>;

export const BAR_HEIGHT = 80;

export const HEX_CHARS = '0123456789ABCDEF';
export const CASCADE_CHARS = '0123456789ABCDEF#±²°µ*±·¬';

export const randChar = (alphabet: string) =>
  alphabet[(Math.random() * alphabet.length) | 0];

export const pad2 = (n: number) => n.toString().padStart(2, '0');
export const pad3 = (n: number) => n.toString().padStart(3, '0');

// ── Format helpers ────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const msR = Math.floor(ms % 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(msR)}`;
}

export function formatEta(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}
