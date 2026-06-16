// Layer — one per unique stroke color in the scene. Carries the cut/engrave
// parameters (power, speed, passes) that the OutputStrategy consumes when
// emitting G-code. WORKFLOW.md F-A7 defines defaults and value ranges.

import type { DitherAlgorithm } from './scene-object';

// Phase F: 'line' = vector cut/engrave along polylines; 'fill' =
// parallel-line hatching inside closed contours (F.1); 'image' =
// raster engrave with per-pixel S modulation (F.2, ADR-020).
export type LayerMode = 'line' | 'fill' | 'image';

// F.2: dither algorithm choice for image-mode layers. Mirrors the
// pure-core enum in scene-object.ts (DitherAlgorithm) so the Layer
// type doesn't reach into the SceneObject module. Kept aligned;
// adding an algorithm here also needs the matching dither.ts arm.
export type LayerDitherAlgorithm = DitherAlgorithm;

export type Layer = {
  readonly id: string;
  readonly color: string; // lowercase 6-digit hex
  readonly mode: LayerMode;
  readonly minPower: number; // 0..100 (percent); grayscale image floor
  readonly power: number; // 0..100 (percent)
  readonly speed: number; // mm/min; ≤ device.maxFeed
  readonly passes: number; // integer ≥ 1
  readonly visible: boolean;
  readonly output: boolean;
  // LightBurn-style per-layer Air Assist intent. It only emits G-code when
  // the active device profile maps air assist to M7 or M8.
  readonly airAssist: boolean;
  // LightBurn-style Line mode kerf compensation in millimeters. Applied only
  // to closed vector contours during output/preview preparation; source
  // artwork stays unchanged. Positive offsets cut outside outer contours and
  // inside holes.
  readonly kerfOffsetMm: number;
  // F.1 fill parameters. Ignored unless mode === 'fill'. Defaults
  // chosen for a typical diode laser: 0° = horizontal hatching,
  // 0.1 mm spacing ≈ 10 lines/mm (LightBurn's diode norm). The prior
  // 0.2 mm ≈ 5 lines/mm showed visible banding on hardware — see the
  // fill quality audit 2026-06-03.
  readonly hatchAngleDeg: number;
  readonly hatchSpacingMm: number;
  readonly fillOverscanMm: number;
  // Bidirectional (snake) hatch fill: alternate each scanline's direction so
  // the head never returns to start between rows (faster). Set false for
  // UNIDIRECTIONAL fill — every row burns the same direction — which removes
  // the alternating laser-firing-lag offset ("zipper") that can serrate small
  // text on a bidirectional fill (ADR-038; burn-perfection Cause C). Default
  // true (speed): the zipper is sub-0.1 mm at typical diode feeds, so most
  // fills want the faster snake.
  readonly fillBidirectional: boolean;
  // LightBurn-style Cross-Hatch: add a second fill pass 90 degrees from the
  // first. Default false so reopening older projects does not double burn time.
  readonly fillCrossHatch: boolean;
  // F.2 image-mode parameters. Ignored unless mode === 'image'.
  // Layer values WIN over per-RasterImage settings at compile time
  // so the operator can re-tune one layer without touching every
  // image on it.
  readonly ditherAlgorithm: LayerDitherAlgorithm;
  readonly linesPerMm: number;
  readonly negativeImage: boolean;
  readonly passThrough: boolean;
  readonly dotWidthCorrectionMm: number;
};

export const LAYER_DEFAULTS = {
  mode: 'line',
  minPower: 0,
  power: 30,
  speed: 1500,
  passes: 1,
  visible: true,
  output: true,
  airAssist: false,
  kerfOffsetMm: 0,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 5,
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'floyd-steinberg',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
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
