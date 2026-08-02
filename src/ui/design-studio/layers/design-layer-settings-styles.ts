import type { CSSProperties } from 'react';

/** Layout for the active design layer settings stack. */
export const DESIGN_SETTINGS_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 6px 4px',
  borderTop: '1px solid var(--lf-border)',
};

/** Shared row layout for design layer setting controls. */
export const DESIGN_FIELD_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text)',
};

/** Shared label layout for design layer setting controls. */
export const DESIGN_FIELD_LABEL_STYLE: CSSProperties = {
  width: 42,
  flexShrink: 0,
  color: 'var(--lf-text-dim)',
  fontSize: 11,
};

/** Shared input treatment for design layer setting controls. */
export const DESIGN_FIELD_INPUT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
};

/** Treatment for the design layer depth shortcut. */
export const DESIGN_THROUGH_BUTTON_STYLE: CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
  flexShrink: 0,
};
