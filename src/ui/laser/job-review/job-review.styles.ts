// Shared inline-style constants for the Job Review dialog (ADR-224).
// Chrome classes (.lf-banner, .lf-card, .lf-dialog…) come from tokens.css;
// these constants only lay the sections out.

import type { CSSProperties } from 'react';

export const sectionStyle: CSSProperties = { marginTop: 14 };

export const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 2,
};

export const machineBadgeStyle: CSSProperties = {
  border: '1px solid var(--lf-accent)',
  color: 'var(--lf-accent)',
  borderRadius: 4,
  padding: '1px 7px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.05em',
};

export const deviceNameStyle: CSSProperties = { fontWeight: 650, fontSize: 13 };

export const connectionLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};

export const statRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 8,
  marginTop: 12,
};

export const statLabelStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

export const statValueStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

export const statDetailStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  overflowWrap: 'anywhere',
};

export const recomputingStyle: CSSProperties = {
  gridColumn: '1 / -1',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

export const bannerStyle: CSSProperties = { marginTop: 12 };

export const bannerListStyle: CSSProperties = {
  margin: '4px 0 0',
  paddingLeft: 18,
  fontSize: 12,
  lineHeight: 1.5,
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
};

export const tableHeaderCellStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--lf-text-muted)',
  padding: '4px 6px',
  borderBottom: '1px solid var(--lf-border)',
  whiteSpace: 'nowrap',
};

export const tableCellStyle: CSSProperties = {
  padding: '3px 6px',
  borderBottom: '1px solid var(--lf-border)',
  verticalAlign: 'middle',
};

export const operationNameCellStyle: CSSProperties = {
  ...tableCellStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 120,
};

export const swatchStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 3,
  flex: '0 0 auto',
  border: '1px solid var(--lf-border)',
};

export const operationNameTextStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 180,
};

export const subOperationNameTextStyle: CSSProperties = {
  ...operationNameTextStyle,
  paddingLeft: 14,
  color: 'var(--lf-text-muted)',
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

export const factListStyle: CSSProperties = { margin: '6px 0 0' };

export const factRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  gap: 8,
  padding: '2px 0',
  fontSize: 12,
};

export const factTermStyle: CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontWeight: 650,
};

export const detailsStyle: CSSProperties = {
  marginTop: 14,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: '7px 10px',
};

export const detailsSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 650,
};

export const mutedNoteStyle: CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.5,
  margin: '6px 0 0',
};

export const ackPromptStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  fontSize: 12,
  lineHeight: 1.5,
  margin: '6px 0 0',
};

export const ackFootnoteStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '8px 0 0',
};

export const verifiedNoteStyle: CSSProperties = {
  borderLeft: '3px solid var(--lf-success)',
  padding: '7px 9px',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  margin: '14px 0 0',
};

export const toolPlanListStyle: CSSProperties = {
  margin: '4px 0 0',
  paddingLeft: 18,
  fontSize: 12,
  lineHeight: 1.5,
};
