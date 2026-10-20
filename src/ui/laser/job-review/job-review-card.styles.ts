// Inline-style constants for the Job Review operation cards (ADR-224 v3) and
// the CNC material & stock card. Colours are tokens.css variables, so both
// themes follow; the operation colour only tints the card's left edge.

import type { CSSProperties } from 'react';

export const operationListStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

// Longhands only: React updates a changed `border` shorthand without
// re-applying an unchanged `borderLeft`, which would drop the colour edge
// when the card enters edit mode.
export function operationCardStyle(color: string, isEditing: boolean): CSSProperties {
  const frame = isEditing ? 'var(--lf-accent)' : 'var(--lf-border)';
  return {
    display: 'grid',
    gap: 8,
    borderStyle: 'solid',
    borderWidth: '1px 1px 1px 4px',
    borderColor: `${frame} ${frame} ${frame} ${color}`,
    borderRadius: 'var(--lf-radius-lg)',
    background: 'var(--lf-bg-input)',
    padding: '9px 12px 10px',
    boxShadow: isEditing ? '0 0 0 3px var(--lf-accent-wash)' : undefined,
  };
}

export const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  minHeight: 26,
};

export const cardNameStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 260,
};

export const cardParentNameStyle: CSSProperties = {
  fontWeight: 400,
  color: 'var(--lf-text-muted)',
};

export const cardMetaStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  whiteSpace: 'nowrap',
};

export const cardActionsStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

export const savedNoteStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 650,
  color: 'var(--lf-success-fg)',
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

export const valueGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
  gap: 8,
};

export const valueTileStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 3,
  minWidth: 0,
  background: 'var(--lf-bg-1)',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-md)',
  padding: '6px 9px',
};

export const valueLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--lf-text-faint)',
  whiteSpace: 'nowrap',
};

export const valueTextStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.15,
  overflowWrap: 'anywhere',
};

// Word values (a tool name, a cut type) read as labels, not measurements.
export const valueWordStyle: CSSProperties = {
  ...valueTextStyle,
  fontSize: 13,
};

export const valueUnitStyle: CSSProperties = {
  marginLeft: 3,
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--lf-text-muted)',
};

export const meterTrackStyle: CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: 'var(--lf-border)',
  overflow: 'hidden',
};

export function meterFillStyle(percent: number): CSSProperties {
  return {
    width: `${Math.max(0, Math.min(100, percent))}%`,
    height: '100%',
    borderRadius: 2,
    background: 'var(--lf-accent)',
  };
}

export function airPillStyle(isOn: boolean): CSSProperties {
  return {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 13,
    fontWeight: 700,
    padding: '1px 9px',
    borderRadius: 999,
    background: isOn ? 'var(--lf-tint-success)' : 'var(--lf-bg-2)',
    color: isOn ? 'var(--lf-success-fg)' : 'var(--lf-text-muted)',
  };
}

export function airDotStyle(isOn: boolean): CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: isOn ? 'var(--lf-success)' : 'var(--lf-border-strong)',
  };
}

export const valueInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 14,
  fontWeight: 650,
};

export const airToggleLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 650,
  minHeight: 26,
  cursor: 'pointer',
};

export const fieldErrorStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-danger-fg)',
  lineHeight: 1.3,
};

// The muted "everything else" line under an operation's numbers.
export const detailLineStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.5,
};

export const compiledDetailsStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

export const compiledSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  width: 'fit-content',
};

export const compiledListStyle: CSSProperties = {
  margin: '4px 0 0',
  paddingLeft: 18,
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
  whiteSpace: 'nowrap',
};

export const materialChipDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flex: '0 0 auto',
};

export const swatchStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 3,
  flex: '0 0 auto',
  border: '1px solid var(--lf-border)',
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
