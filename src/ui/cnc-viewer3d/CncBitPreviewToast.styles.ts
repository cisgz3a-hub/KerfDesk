import type { CSSProperties } from 'react';

export const toastStyle: CSSProperties = {
  position: 'fixed',
  right: 16,
  top: 56,
  width: 'min(380px, calc(100vw - 32px))',
  display: 'grid',
  gridTemplateColumns: '144px minmax(0, 1fr)',
  gap: 12,
  padding: 12,
  border: '1px solid var(--lf-border-strong)',
  borderRadius: 8,
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  boxShadow: 'var(--lf-shadow)',
  fontFamily: 'system-ui, sans-serif',
  zIndex: 'var(--lf-z-toast)' as CSSProperties['zIndex'],
};

export const canvasFrameStyle: CSSProperties = {
  position: 'relative',
  minHeight: 128,
  overflow: 'hidden',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  background: 'var(--lf-bg-2)',
};

export const canvasStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 128,
};

export const fallbackStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  margin: 0,
  padding: 12,
  color: 'var(--lf-text-muted)',
  background: 'var(--lf-bg-2)',
  fontSize: 'var(--lf-text-sm)',
  lineHeight: 1.35,
  textAlign: 'center',
};

export const copyStyle: CSSProperties = {
  minWidth: 0,
  paddingRight: 20,
};

export const eyebrowStyle: CSSProperties = {
  margin: '1px 0 3px',
  color: 'var(--lf-accent-fg)',
  fontSize: 'var(--lf-text-xs)',
  fontWeight: 700,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
};

export const titleStyle: CSSProperties = {
  margin: 0,
  overflow: 'hidden',
  fontSize: 'var(--lf-text-lg)',
  lineHeight: 1.3,
  textOverflow: 'ellipsis',
};

export const noteStyle: CSSProperties = {
  margin: '8px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
  lineHeight: 1.4,
};

export const closeStyle: CSSProperties = {
  position: 'absolute',
  top: 7,
  right: 7,
  width: 26,
  height: 26,
  padding: 0,
  border: '1px solid transparent',
  borderRadius: 4,
  color: 'var(--lf-text-muted)',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
};
