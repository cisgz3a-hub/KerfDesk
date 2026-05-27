// Layer — one per unique stroke color in the scene. Carries the cut/engrave
// parameters (power, speed, passes) that the OutputStrategy consumes when
// emitting G-code. WORKFLOW.md F-A7 defines defaults and value ranges.

// Phase F activates the 'fill' arm (F.1) and parks 'image' for F.2.
// 'line' = vector cut/engrave along the polylines themselves. 'fill' =
// parallel-line hatching inside a closed contour. 'image' = raster
// engrave (per-pixel S modulation) — defined for future SceneObject
// kinds (RasterImage), but no Layer with mode='image' compiles yet.
export type LayerMode = 'line' | 'fill' | 'image';

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
} as const satisfies Omit<Layer, 'id' | 'color'>;

export function createLayer(args: { id: string; color: string }): Layer {
  return { id: args.id, color: args.color, ...LAYER_DEFAULTS };
}
