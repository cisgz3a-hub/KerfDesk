// Isolating part of the job in the 3D view (ADR-470): which moves the legend
// has switched off, which heights the Z range keeps, and which side of a
// section stays. Pure, so the planes and masks are unit-tested apart from the
// scene that applies them.

import type { GcodeRenderModel } from '../../core/gcode-view';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dClipPlane } from '../viewer3d/scene-isolate';

export type SectionAxis = 'x' | 'y';

export type IsolateState = {
  /** Lowest and highest Z drawn, mm; null draws every height. */
  readonly zRange: { readonly low: number; readonly high: number } | null;
  /** A vertical cut through the job; `flip` keeps the far side instead. */
  readonly section: {
    readonly axis: SectionAxis;
    readonly at: number;
    readonly flip: boolean;
  } | null;
};

export const NO_ISOLATE: IsolateState = { zRange: null, section: null };

// Moves lying exactly on a limit stay drawn: a pass at Z -2 is kept by a
// range that ends at -2, whatever the float rounding.
const EDGE_MM = 0.001;
// A Z range slider with more stops than this steps evenly instead (a 3D
// finish has a level per row).
const MAX_Z_STOPS = 200;

/** Clipping planes for the Z range and section. */
export function isolatePlanes(state: IsolateState): ReadonlyArray<Viewer3dClipPlane> {
  const planes: Viewer3dClipPlane[] = [];
  if (state.zRange !== null) {
    planes.push({ normal: [0, 0, 1], constant: -(state.zRange.low - EDGE_MM) });
    planes.push({ normal: [0, 0, -1], constant: state.zRange.high + EDGE_MM });
  }
  const section = state.section;
  if (section !== null) {
    const sign = section.flip ? 1 : -1;
    const normal: [number, number, number] = section.axis === 'x' ? [sign, 0, 0] : [0, sign, 0];
    // Keeps the near side (coordinates up to `at`), or the far side when flipped.
    planes.push({ normal, constant: -sign * section.at });
  }
  return planes;
}

/**
 * The heights the Z range slider stops at, lowest first: the job's bottom
 * and top and every cutting level between, or even steps when a finishing
 * pass has too many levels to list. Null when the program never moves.
 */
export function zStops(model: GcodeRenderModel): ReadonlyArray<number> | null {
  const bounds = model.stats.motionBounds;
  if (bounds === null) return null;
  if (model.stats.zLevels.length > MAX_Z_STOPS) {
    const span = bounds.maxZ - bounds.minZ;
    return Array.from({ length: MAX_Z_STOPS + 1 }, (_, step) =>
      roundMicron(bounds.minZ + (span * step) / MAX_Z_STOPS),
    );
  }
  const heights = new Set([bounds.minZ, ...model.stats.zLevels, bounds.maxZ].map(roundMicron));
  return [...heights].sort((low, high) => low - high);
}

/** Per segment 1 to draw or 0 to leave out; null when nothing is switched off. */
export function moveFilterMask(
  segmentCount: number,
  entryOf: (segmentIndex: number) => number,
  hidden: ReadonlySet<number>,
): Uint8Array | null {
  if (hidden.size === 0) return null;
  const visible = new Uint8Array(segmentCount);
  for (let index = 0; index < segmentCount; index += 1) {
    visible[index] = hidden.has(entryOf(index)) ? 0 : 1;
  }
  return visible;
}

function roundMicron(value: number): number {
  return Math.round(value * 1000) / 1000;
}
