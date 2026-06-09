import type { CSSProperties } from 'react';

export const calibrationBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.35)',
};

export const calibrationDialogStyle: CSSProperties = {
  width: 380,
  maxWidth: 'calc(100vw - 32px)',
  background: '#fff',
  color: '#111',
  border: '1px solid #bbb',
  borderRadius: 6,
  padding: 14,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.24)',
};

export const calibrationHeadingStyle: CSSProperties = { margin: '0 0 12px 0', fontSize: 16 };

export const calibrationGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8,
};

export const calibrationButtonRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 14,
};
