import type { CSSProperties } from 'react';

export const detailsStyle: CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
  marginTop: 4,
};
export const summaryStyle: CSSProperties = {
  fontSize: 12,
  cursor: 'pointer',
  userSelect: 'none',
  color: 'var(--lf-text-muted)',
};
export const noticeStyle: CSSProperties = {
  fontSize: 11,
  lineHeight: 1.35,
  color: 'var(--lf-text-muted)',
  margin: '6px 0',
};
export const searchStyle: CSSProperties = { width: '100%', padding: '3px 6px' };
export const catalogListStyle: CSSProperties = {
  maxHeight: 320,
  overflowY: 'auto',
  marginTop: 6,
};
export const familyStyle: CSSProperties = { contentVisibility: 'auto' };
export const familyHeadingStyle: CSSProperties = { fontSize: 11, margin: '8px 0 3px' };
export const rowsStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};
export const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
};
export const referenceRowStyle: CSSProperties = {
  ...rowStyle,
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  paddingBottom: 4,
};
export const entryNameStyle: CSSProperties = { minWidth: 0 };
export const addedStyle: CSSProperties = { color: 'var(--lf-text-muted)' };
export const sourceStyle: CSSProperties = { color: 'var(--lf-text-muted)' };
export const sourceUrlStyle: CSSProperties = {
  display: 'block',
  gridColumn: '1 / -1',
  maxWidth: 260,
  overflowWrap: 'anywhere',
  userSelect: 'text',
};
export const reasonStyle: CSSProperties = {
  gridColumn: '1 / -1',
  color: 'var(--lf-text-muted)',
  lineHeight: 1.3,
};
export const emptyStyle: CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };
