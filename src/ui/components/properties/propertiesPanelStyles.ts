/**
 * T1-131: module-level style constants for `PropertiesPanel`.
 * Pre-T1-131 these 9 `React.CSSProperties` literals lived inside
 * the `ObjectPropertiesTab` function body (lines 316-388) and got
 * re-created on every render. They're pure — every value comes from
 * the static `theme` module — so hoisting to module scope is a
 * straightforward refactor that:
 *
 *   - shrinks PropertiesPanel.tsx by ~75 lines
 *   - skips the per-render object allocation
 *   - makes the panel's render code easier to scan (less style
 *     definition wedged between hooks and JSX)
 *   - lets future tab extractions (image / cut / engrave / text)
 *     reuse the same shared styles without prop-drilling
 *
 * No behavioral change — `style` props on every consumer receive
 * the same object shape they did pre-extraction.
 */
import type { CSSProperties } from 'react';
import { theme } from '../../styles/theme';

export const containerStyle: CSSProperties = {
  padding: '10px 12px',
  fontFamily: theme.font.ui,
  color: theme.text.secondary,
};

export const labelStyle: CSSProperties = {
  fontSize: theme.font.size.xs,
  color: theme.text.secondary,
  fontFamily: theme.font.ui,
  marginBottom: 2,
};

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  background: theme.bg.base,
  border: `1px solid ${theme.border.default}`,
  borderRadius: theme.radius.sm,
  color: theme.text.primary,
  fontSize: theme.font.size.sm,
  fontFamily: theme.font.mono,
  outline: 'none',
  marginBottom: 6,
};

export const selectStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: theme.font.ui,
  cursor: 'pointer',
};

export const sectionHeaderStyle: CSSProperties = {
  fontSize: theme.font.size.sm,
  fontWeight: 600,
  color: theme.text.secondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 6,
};

export const emptyStateStyle: CSSProperties = {
  padding: 12,
  color: theme.text.tertiary,
  fontSize: theme.font.size.sm,
  fontFamily: theme.font.ui,
  fontStyle: 'italic' as const,
};

export const dividerStyle: CSSProperties = {
  marginTop: 8,
  borderTop: `1px solid ${theme.border.subtle}`,
  paddingTop: 8,
};

export const traceButtonStyle: CSSProperties = {
  width: '100%',
  padding: '7px 12px',
  background: 'rgba(45, 212, 160, 0.1)',
  border: `1px solid ${theme.accent.green}`,
  borderRadius: theme.radius.md,
  color: theme.accent.green,
  cursor: 'pointer',
  fontFamily: theme.font.ui,
  fontSize: theme.font.size.sm,
  fontWeight: 500,
  transition: `all ${theme.transition.fast}`,
};

export const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
};
