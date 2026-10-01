// The Pro tools of KerfDesk's Free/Pro split (ADR-540). Free keeps drawing,
// text, import, basic trace, laser cut and engrave, 2D CNC cuts and every
// machine control; only starting or opening one of these tools needs Pro.
// Output of a project that already holds Pro operations is never gated, so a
// job made during a trial still frames and runs after it ends.

export type ProFeature =
  | 'vcarve'
  | 'relief'
  | 'adaptive-clearing'
  | 'advanced-trace'
  | 'camera-alignment'
  | 'box-generator'
  | 'design-studio'
  | 'gcode-inspector';

export const PRO_FEATURES: Readonly<
  Record<ProFeature, { readonly name: string; readonly summary: string }>
> = {
  vcarve: {
    name: 'V-carve',
    summary: 'Carve lettering and artwork with a V-bit, cutting deeper where shapes are wider.',
  },
  relief: {
    name: '3D relief',
    summary: 'Rough and finish 3D reliefs from height maps and models.',
  },
  'adaptive-clearing': {
    name: 'Adaptive clearing',
    summary: 'Clear pockets with a constant tool load for faster, gentler cuts.',
  },
  'advanced-trace': {
    name: 'Advanced tracing',
    summary:
      'Centerline, colour-layer, photo-shading and multi-file tracing, beyond the outline presets.',
  },
  'camera-alignment': {
    name: 'Camera alignment',
    summary: 'Calibrate the camera lens and align its picture to your machine bed.',
  },
  'box-generator': {
    name: 'Box generator',
    summary: 'Make finger-jointed boxes sized to your material in a few clicks.',
  },
  'design-studio': {
    name: 'Design Studio',
    summary:
      'Draw parts to size by hand in a full window, with precision tools, snapping and dimensions.',
  },
  'gcode-inspector': {
    name: 'G-code Inspector',
    summary: 'Open any G-code file, or this project’s own, and check it move by move in 3D.',
  },
};

/** Marks a Pro choice in a list while Pro is locked, as "V-carve (Pro)". */
export function proChoiceLabel(label: string, locked: boolean): string {
  return locked ? `${label} (Pro)` : label;
}

// Prices are before tax: Paddle adds the tax where the buyer lives and shows the
// total before payment (docs/legal/kerfdesk-pricing.md).
export const PRO_PRICE_LABEL = 'US$49.50 plus tax';
export const RENEWAL_PRICE_LABEL = 'US$20 plus tax';
