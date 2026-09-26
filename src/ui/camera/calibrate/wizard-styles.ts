// Shared layout for the camera calibration wizard steps.

import type { CSSProperties } from 'react';

export const columnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
export const rowStyle: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
export const noteStyle: CSSProperties = { margin: 0, color: 'var(--lf-text-faint)' };
export const errStyle: CSSProperties = { margin: 0, color: 'var(--lf-danger-fg)' };
export const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
};
export const inputStyle: CSSProperties = { width: 120 };
