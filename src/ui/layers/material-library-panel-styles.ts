import type { CSSProperties } from 'react';

export const sectionStyle: CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  borderBottom: '1px solid var(--lf-border)',
  padding: '10px 0',
  marginBottom: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

export const headingStyle: CSSProperties = { fontSize: 14, margin: 0 };

export const libraryHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

export const libraryNameStyle: CSSProperties = {
  color: 'var(--lf-text)',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const buttonRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

export const fieldStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '64px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 8,
};

export const labelStyle: CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };

export const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

export const calibrationContextStyle: CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

export const calibrationHeadingStyle: CSSProperties = {
  color: 'var(--lf-text)',
  fontSize: 12,
};

export const calibrationTextStyle: CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.35,
};

export const splitRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 6,
};

export const statusStyle: CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
