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
export const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: '6px 0',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 160,
  overflowY: 'auto',
};
export const toolGroupStyle: CSSProperties = { listStyle: 'none' };
export const toolGroupHeadingStyle: CSSProperties = {
  fontSize: 11,
  margin: '5px 0 2px',
  color: 'var(--lf-text-muted)',
};
export const toolGroupListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
export const listItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 6,
  fontSize: 12,
};
export const toolNameStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  lineHeight: 1.3,
};
export const toolFamilyStyle: CSSProperties = { color: 'var(--lf-text-faint)' };
export const deleteButtonStyle: CSSProperties = { flexShrink: 0 };
export const addFormStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginTop: 6,
  flexWrap: 'wrap',
};
export const nameInputStyle: CSSProperties = { flex: 1, minWidth: 90, padding: '2px 6px' };
export const kindSelectStyle: CSSProperties = { fontSize: 12, padding: '2px 4px' };
export const numberInputStyle: CSSProperties = { width: 64, padding: '2px 6px' };
