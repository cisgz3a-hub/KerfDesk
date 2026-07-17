// Shared inline-style constants for the Job Review dialog sections (ADR-224
// v2 look). Chrome classes (.lf-banner, .lf-dialog…) come from tokens.css;
// table and stock-card styles live in job-review-table.styles.ts.

import type { CSSProperties } from 'react';

// .lf-dialog padding (--lf-space-6); the sticky footer bleeds through it.
const DIALOG_PADDING_PX = 16;

export const sectionStyle: CSSProperties = { marginTop: 14 };

// Uppercase micro-label heading a section (kept an h3 for the a11y outline).
export const sectionHeadingStyle: CSSProperties = {
  margin: '0 0 7px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--lf-text-faint)',
};

export const sectionHintStyle: CSSProperties = {
  marginLeft: 8,
  fontWeight: 400,
  letterSpacing: 0,
  textTransform: 'none',
};

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

export const statTileStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: 'var(--lf-bg-0)',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-lg)',
  padding: '9px 11px 8px',
};

// The estimated-time tile is the one number every start decision weighs;
// the accent tint makes it the band's anchor.
export const heroTileStyle: CSSProperties = {
  ...statTileStyle,
  background: 'var(--lf-tint-info)',
};

export const statLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--lf-text-faint)',
};

export const statValueStyle: CSSProperties = {
  fontSize: 19,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.2,
};

// Word-valued tiles (the Origin tile) read as labels, not measurements.
export const statTextValueStyle: CSSProperties = {
  ...statValueStyle,
  fontSize: 14,
  paddingTop: 3,
};

export const heroValueColor = 'var(--lf-accent-fg)';

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

export const warnDetailsStyle: CSSProperties = {
  marginTop: 12,
  background: 'var(--lf-tint-warning)',
  border: '1px solid var(--lf-border)',
  borderLeft: '3px solid var(--lf-warning)',
  borderRadius: 'var(--lf-radius-lg)',
};

export const warnSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  padding: '8px 11px',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--lf-warning-fg)',
};

export const warnHintStyle: CSSProperties = { fontWeight: 400, opacity: 0.85 };

export const warnListStyle: CSSProperties = {
  margin: 0,
  padding: '0 14px 9px 30px',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--lf-text)',
};

export const bannerStyle: CSSProperties = { marginTop: 12 };

export const bannerListStyle: CSSProperties = {
  margin: '4px 0 0',
  paddingLeft: 18,
  fontSize: 12,
  lineHeight: 1.5,
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
  marginTop: 10,
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-lg)',
  padding: '7px 10px',
};

export const detailsSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 650,
};

export const detailsSummaryCountStyle: CSSProperties = {
  marginLeft: 6,
  fontWeight: 400,
  fontSize: 11,
  color: 'var(--lf-text-faint)',
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

// Sticky inside the .lf-dialog scroll container: Cancel/Start stay visible
// while the operator scrolls a long review. Negative margins bleed through
// the panel padding so the bar spans edge to edge.
export const footerBarStyle: CSSProperties = {
  position: 'sticky',
  bottom: -DIALOG_PADDING_PX,
  margin: `14px -${DIALOG_PADDING_PX}px -${DIALOG_PADDING_PX}px`,
  padding: `10px ${DIALOG_PADDING_PX}px`,
  background: 'var(--lf-bg-1)',
  borderTop: '1px solid var(--lf-border)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  zIndex: 1,
};

export const footerOriginStyle: CSSProperties = {
  marginRight: 'auto',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  overflowWrap: 'anywhere',
};

export const startButtonContentStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
