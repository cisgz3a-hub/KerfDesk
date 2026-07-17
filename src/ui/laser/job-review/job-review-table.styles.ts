// Inline-style constants for the Job Review artwork-settings table and the
// CNC material & stock card (ADR-224 v2).

import type { CSSProperties } from 'react';

export const tableWrapStyle: CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-lg)',
  overflowX: 'auto',
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
  minWidth: 560,
};

export const tableHeaderCellStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--lf-text-faint)',
  background: 'var(--lf-bg-0)',
  padding: '6px 8px',
  borderBottom: '1px solid var(--lf-border)',
  whiteSpace: 'nowrap',
};

export const tableCellStyle: CSSProperties = {
  padding: '6px 8px',
  verticalAlign: 'middle',
};

export const operationNameCellStyle: CSSProperties = {
  ...tableCellStyle,
  minWidth: 140,
};

export const operationNameInnerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export const swatchStyle: CSSProperties = {
  width: 13,
  height: 13,
  borderRadius: 3,
  flex: '0 0 auto',
  border: '1px solid var(--lf-border)',
};

export const operationNameTextStyle: CSSProperties = {
  fontWeight: 650,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 170,
};

export const subOperationNameTextStyle: CSSProperties = {
  ...operationNameTextStyle,
  fontWeight: 400,
  paddingLeft: 21,
  color: 'var(--lf-text-muted)',
};

export const modeChipStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  padding: '1px 7px',
  borderRadius: 999,
  background: 'var(--lf-tint-info)',
  color: 'var(--lf-accent-fg)',
  whiteSpace: 'nowrap',
};

// The muted "everything else" line under an operation row.
export const detailCellStyle: CSSProperties = {
  padding: '0 8px 8px 32px',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.5,
};

export const materialChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 11,
  fontWeight: 650,
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 999,
  padding: '0 8px 0 5px',
  background: 'var(--lf-bg-2)',
  marginRight: 6,
};

export const materialChipDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flex: '0 0 auto',
};

export const cellInputStyle: CSSProperties = {
  width: 72,
  fontVariantNumeric: 'tabular-nums',
};

export const airCellLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
};

export const stockCardStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '6px 18px',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-lg)',
  background: 'var(--lf-bg-0)',
  padding: '10px 12px',
  fontSize: 12,
};

export const stockItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

export const stockLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--lf-text-faint)',
};

export const stockValueStyle: CSSProperties = {
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};
