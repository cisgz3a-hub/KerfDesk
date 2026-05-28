// Layer — one per unique stroke color in the scene. Carries the cut/engrave
// parameters (power, speed, passes) that the OutputStrategy consumes when
// emitting G-code. WORKFLOW.md F-A7 defines defaults and value ranges.

// Phase F: 'line' = vector cut/engrave along polylines; 'fill' =
// parallel-line hatching inside closed contours (F.1); 'image' =
// raster engrave with per-pixel S modulation (F.2, ADR-020).
export type LayerMode = 'line' | 'fill' | 'image';

// F.2: dither algorithm choice for image-mode layers. Mirrors the
// pure-core enum in scene-object.ts (DitherAlgorithm) so the Layer
// type doesn't reach into the SceneObject module. Kept aligned;
// adding an algorithm here also needs the matching dither.ts arm.
export type LayerDitherAlgorithm = 'threshold' | 'floyd-steinberg' | 'grayscale';

export type Layer = {
  readonly id: string;
  readonly color: string; // lowercase 6-digit hex
  readonly mode: LayerMode;
  readonly power: number; // 0..100 (percent)
  readonly speed: number; // mm/min; ≤ device.maxFeed
  readonly passes: number; // integer ≥ 1
  readonly visible: boolean;
  readonly output: boolean;
  // F.1 fill parameters. Ignored unless mode === 'fill'. Defaults
  // chosen for a typical 5W diode laser: 0° = horizontal hatching,
  // 0.2 mm spacing ≈ 5 lines/mm (good for engraved fills without
  // visible banding at standard kerfs).
  readonly hatchAngleDeg: number;
  readonly hatchSpacingMm: number;
  // F.2 image-mode parameters. Ignored unless mode === 'image'.
  // Layer values WIN over per-RasterImage settings at compile time
  // so the operator can re-tune one layer without touching every
  // image on it.
  readonly ditherAlgorithm: LayerDitherAlgorithm;
  readonly linesPerMm: number;
};

export const LAYER_DEFAULTS = {
  mode: 'line',
  power: 30,
  speed: 1500,
  passes: 1,
  visible: true,
  output: true,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.2,
  ditherAlgorithm: 'floyd-steinberg',
  linesPerMm: 10,
} as const satisfies Omit<Layer, 'id' | 'color'>;

export function createLayer(args: { id: string; color: string; mode?: LayerMode }): Layer {
  // mode override (F.2.c): raster-image imports want mode='image'
  // from the moment their layer is auto-created so the user doesn't
  // have to toggle. Other callers (SVG / text imports) omit it and
  // inherit LAYER_DEFAULTS.mode ('line').
  return {
    id: args.id,
    color: args.color,
    ...LAYER_DEFAULTS,
    ...(args.mode !== undefined ? { mode: args.mode } : {}),
  };
}
