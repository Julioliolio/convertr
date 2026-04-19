// ── Design tokens (exact from Paper) ──────────────────────────────────────────
export const ACCENT    = '#FC006D';
export const ACCENT_75 = 'rgba(252,0,109,0.75)';
export const ACCENT_50 = 'rgba(252,0,109,0.5)';
export const ACCENT_25 = 'rgba(252,0,109,0.25)';
export const BG        = '#F8F7F6';
export const MONO      = "'IBM Plex Mono', system-ui, monospace";

// Shared 32px dotted background — used by idle splash, editor result frame,
// and anywhere else we want the Paper-style visible-grid feel.
export const DOT_BG_IMAGE = `radial-gradient(circle, ${ACCENT_50} 1px, transparent 1px)`;
