/**
 * LaserForge Design System
 * Industrial Modern — dark, precise, professional
 */

export const theme = {
  // Background layers (darkest to lightest)
  bg: {
    base: '#0a0a12',
    panel: '#0f0f1a',
    surface: '#141422',
    elevated: '#1a1a2e',
    hover: '#222238',
    active: '#2a2a44',
  },

  // Borders
  border: {
    subtle: '#1a1a2e',
    default: '#252540',
    strong: '#333355',
  },

  // Text
  text: {
    primary: '#e0e0ec',
    secondary: '#8888aa',
    tertiary: '#555570',
    accent: '#00d4ff',
  },

  // Accents
  accent: {
    cyan: '#00d4ff',
    green: '#2dd4a0',
    red: '#ff4466',
    orange: '#ff8844',
    yellow: '#ffd444',
    purple: '#aa66ff',
  },

  // Layer colors (match laser modes)
  layer: {
    cut: '#ff4466',
    engrave: '#4488ff',
    score: '#44cc66',
    image: '#ffaa22',
  },

  // Fonts
  font: {
    ui: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
    size: {
      xs: '10px',
      sm: '11px',
      md: '12px',
      lg: '13px',
      xl: '14px',
    },
  },

  // Spacing
  space: {
    xs: 2,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
  },

  // Radius
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
  },

  // Transitions
  transition: {
    fast: '0.1s ease',
    normal: '0.2s ease',
  },
} as const;

// Common styles as reusable objects
export const styles = {
  panelHeader: {
    padding: '10px 12px',
    fontSize: theme.font.size.md,
    fontWeight: 600,
    color: theme.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    borderBottom: `1px solid ${theme.border.subtle}`,
    fontFamily: theme.font.ui,
  },

  input: {
    background: theme.bg.base,
    border: `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.sm,
    color: theme.text.primary,
    padding: '5px 8px',
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.mono,
    outline: 'none',
    width: '100%',
    transition: `border-color ${theme.transition.fast}`,
  },

  select: {
    background: theme.bg.base,
    border: `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.sm,
    color: theme.text.primary,
    padding: '5px 8px',
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.ui,
    outline: 'none',
    width: '100%',
    cursor: 'pointer',
  },

  button: {
    background: theme.bg.elevated,
    border: `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.sm,
    color: theme.text.primary,
    padding: '6px 12px',
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.ui,
    cursor: 'pointer',
    transition: `all ${theme.transition.fast}`,
    outline: 'none',
  },

  buttonPrimary: {
    background: 'rgba(0, 212, 255, 0.12)',
    border: `1px solid ${theme.accent.cyan}`,
    borderRadius: theme.radius.sm,
    color: theme.accent.cyan,
    padding: '6px 12px',
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.ui,
    fontWeight: 500,
    cursor: 'pointer',
    transition: `all ${theme.transition.fast}`,
    outline: 'none',
  },

  label: {
    fontSize: theme.font.size.sm,
    color: theme.text.secondary,
    fontFamily: theme.font.ui,
    marginBottom: 3,
  },
};
