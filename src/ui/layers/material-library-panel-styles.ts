import type { CSSProperties } from 'react';

export const sectionStyle: CSSProperties = {
  padding: '4px 0',
  minWidth: 0,
  marginBottom: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

export const headingStyle: CSSProperties = { fontSize: 16, margin: 0 };

export const hintStyle: CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0,
};

export const libraryNameStyle: CSSProperties = {
  color: 'var(--lf-text)',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  margin: 0,
};

export const buttonRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

export const fieldStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  minWidth: 0,
  alignItems: 'center',
  gap: 5,
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
