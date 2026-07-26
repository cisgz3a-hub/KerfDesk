// Theme tokens for the shared 3D viewer home (ADR-255; ADR-102 §2 as
// amended). Colors resolve from the app's CSS custom properties at scene
// creation so the 3D view follows the active theme instead of drifting on
// hard-coded hexes; numeric fallbacks cover tests and detached canvases.
// Stage 9 (lenses) wires the --lf-viewer3d-* variables into the theme CSS.

export type Viewer3dTheme = {
  readonly background: number;
  readonly gridMinor: number;
  readonly gridMajor: number;
  /** Traversal red per the LightBurn convention (recessive in the scene). */
  readonly travel: number;
  readonly cut: number;
  readonly plunge: number;
  readonly retract: number;
  /** Direction arrowheads: reads over the toolpath, not as another move kind. */
  readonly arrow: number;
};

const FALLBACK: Viewer3dTheme = {
  background: 0x1c1f24,
  gridMinor: 0x2a2e35,
  gridMajor: 0x3c424c,
  travel: 0xcc4444,
  cut: 0x4fa3ff,
  plunge: 0xffb84d,
  retract: 0x9a7fd4,
  arrow: 0xf2f4f8,
};

const VAR_NAMES: Readonly<Record<keyof Viewer3dTheme, string>> = {
  background: '--lf-viewer3d-bg',
  gridMinor: '--lf-viewer3d-grid-minor',
  gridMajor: '--lf-viewer3d-grid-major',
  travel: '--lf-viewer3d-travel',
  cut: '--lf-viewer3d-cut',
  plunge: '--lf-viewer3d-plunge',
  retract: '--lf-viewer3d-retract',
  arrow: '--lf-viewer3d-arrow',
};

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

export function resolveViewer3dTheme(root?: Element | null): Viewer3dTheme {
  const element = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (element === null || typeof getComputedStyle === 'undefined') return FALLBACK;
  const style = getComputedStyle(element);
  const resolve = (key: keyof Viewer3dTheme): number => {
    const raw = style.getPropertyValue(VAR_NAMES[key]).trim();
    const match = HEX_COLOR.exec(raw);
    const hex = match?.[1];
    return hex === undefined ? FALLBACK[key] : Number.parseInt(hex, 16);
  };
  return {
    background: resolve('background'),
    gridMinor: resolve('gridMinor'),
    gridMajor: resolve('gridMajor'),
    travel: resolve('travel'),
    cut: resolve('cut'),
    plunge: resolve('plunge'),
    retract: resolve('retract'),
    arrow: resolve('arrow'),
  };
}
