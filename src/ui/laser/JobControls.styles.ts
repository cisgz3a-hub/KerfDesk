import type { CSSProperties } from 'react';

export const containerStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
export const rowStyle: CSSProperties = { display: 'flex', gap: 6 };
export const stopBtnStyle: CSSProperties = {
  background: 'var(--lf-danger)',
  color: 'var(--lf-on-fill)',
};
export const progressContainerStyle: CSSProperties = {
  position: 'relative',
  background: 'var(--lf-bg-input)',
  height: 18,
  borderRadius: 3,
  overflow: 'hidden',
};
export const progressFillStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  background: 'var(--lf-accent)',
  transition: 'width 100ms linear',
};
export const progressLabelStyle: CSSProperties = {
  position: 'relative',
  textAlign: 'center',
  fontSize: 11,
  lineHeight: '18px',
  color: 'var(--lf-text)',
};
export const estimateStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  alignSelf: 'center',
  fontVariantNumeric: 'tabular-nums',
};
export const runningSafetyStyle: CSSProperties = {
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  lineHeight: 1.3,
};
