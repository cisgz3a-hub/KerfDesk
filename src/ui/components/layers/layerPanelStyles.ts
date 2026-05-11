/**
 * T1-141: module-level style constants for `LayerPanel`. Pre-T1-141
 * 8 inline style objects + 1 inline style-function lived inside the
 * `LayerPanel` function body (lines 234-310) and got recreated on
 * every render. Every value comes from the static `theme` module, so
 * hoisting to module scope is a no-behavior-change allocation win
 * and reduces render-body noise.
 *
 * Same pattern as T1-131 (PropertiesPanel).
 *
 * `iconToggleStyle` is kept as a function — it closes over the layer's
 * `visible` flag for color/opacity. The function reference is now
 * module-scope; only its per-call return object remains per-render
 * (one per visible layer row).
 */
import type { CSSProperties } from 'react';
import { theme } from '../../styles/theme';
import type { Layer } from '../../../core/scene/Layer';

export const outerColumnStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  fontFamily: theme.font.ui,
  borderBottom: `1px solid ${theme.border.subtle}`,
  overflow: 'hidden' as const,
  background: '#0c0c18',
};

export const scrollTabContentStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto' as const,
};

export const listStyle: CSSProperties = {
  padding: '4px 0',
  borderBottom: `1px solid ${theme.border.subtle}`,
  flexShrink: 0,
};

export const settingsStyle: CSSProperties = {
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 10,
};

export const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
};

export const settingsLabelStyle: CSSProperties = {
  fontSize: theme.font.size.xs,
  color: theme.text.secondary,
  fontFamily: theme.font.ui,
  marginBottom: 2,
};

export const numberInputStyle: CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  background: theme.bg.base,
  border: `1px solid ${theme.border.default}`,
  borderRadius: theme.radius.sm,
  color: theme.text.primary,
  fontSize: theme.font.size.sm,
  fontFamily: theme.font.mono,
  outline: 'none',
};

export const selectStyle: CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  background: theme.bg.base,
  border: `1px solid ${theme.border.default}`,
  borderRadius: theme.radius.sm,
  color: theme.text.primary,
  fontSize: theme.font.size.sm,
  fontFamily: theme.font.ui,
  outline: 'none',
  cursor: 'pointer',
};

/**
 * Per-layer icon-toggle style. Closes over `layer.visible` for
 * color/opacity. Function reference is module-scope; the returned
 * object is created per call.
 */
export const iconToggleStyle = (layer: Layer): CSSProperties => ({
  background: 'none',
  border: 'none',
  color: layer.visible ? theme.text.secondary : theme.text.tertiary,
  cursor: 'pointer',
  fontSize: 12,
  padding: 2,
  opacity: layer.visible ? 1 : 0.4,
});
