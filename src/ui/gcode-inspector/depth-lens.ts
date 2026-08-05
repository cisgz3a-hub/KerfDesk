// Pure depth/pass colour scale for the G-code 3D viewer. It reads only
// machining moves, so safe-height travel never flattens the useful cut range.

import { SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';

/** Normalized red, green, and blue channels in renderer order. */
export type Rgb = readonly [number, number, number];

/** Ordered machining-depth bounds and the colour lookup derived from them. */
export type DepthLensScale = {
  readonly shallowMm: number;
  readonly deepMm: number;
  readonly levelCount: number;
  readonly colorOf: (segmentIndex: number) => Rgb;
};

// One calm sequential blue scale: shallow passes are lighter and deeper
// passes are darker. Every channel changes in one direction, so adjacent
// depths stay adjacent shades rather than becoming unrelated colours.
/** Light endpoint used for the shallowest machining depth. */
export const DEPTH_RAMP_SHALLOW: Rgb = [0.68, 0.82, 0.96];
/** Dark endpoint used for the deepest machining depth. */
export const DEPTH_RAMP_DEEP: Rgb = [0.18, 0.45, 0.78];

const DEPTH_LEVEL_ROUND = 1000;
const DEPTH_LEVEL_TOLERANCE_MM = 1 / DEPTH_LEVEL_ROUND;
const MIN_DEPTH_SPAN_MM = 1e-9;
const FLOATS_PER_SEGMENT = 6;

/** Build the ordered depth scale once per program/lens change. */
export function buildDepthLensScale(model: GcodeRenderModel): DepthLensScale | null {
  const range = machiningDepthRange(model);
  if (range === null) return null;
  return {
    ...range,
    levelCount: depthLevelCount(model, range),
    colorOf: (segmentIndex) => depthColor(segmentDepth(model, segmentIndex), range),
  };
}

type DepthRange = {
  readonly shallowMm: number;
  readonly deepMm: number;
};

function machiningDepthRange(model: GcodeRenderModel): DepthRange | null {
  const cutRange = rangeForKind(model, SEG_KIND.cut);
  const plungeRange = rangeForKind(model, SEG_KIND.plunge);
  if (cutRange === null) return plungeRange;
  if (plungeRange === null) return cutRange;
  return {
    shallowMm: Math.max(cutRange.shallowMm, plungeRange.shallowMm),
    deepMm: Math.min(cutRange.deepMm, plungeRange.deepMm),
  };
}

function rangeForKind(model: GcodeRenderModel, targetKind: number): DepthRange | null {
  let shallowMm = -Infinity;
  let deepMm = Infinity;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segKind[index] !== targetKind) continue;
    const base = index * FLOATS_PER_SEGMENT;
    const startZ = model.positions[base + 2] ?? 0;
    const endZ = model.positions[base + 5] ?? 0;
    const segmentShallow = targetKind === SEG_KIND.cut ? Math.max(startZ, endZ) : endZ;
    const segmentDeep = targetKind === SEG_KIND.cut ? Math.min(startZ, endZ) : endZ;
    shallowMm = Math.max(shallowMm, segmentShallow);
    deepMm = Math.min(deepMm, segmentDeep);
  }
  return shallowMm === -Infinity ? null : { shallowMm, deepMm };
}

function depthLevelCount(model: GcodeRenderModel, range: DepthRange): number {
  const levels = new Set<number>();
  for (const level of model.stats.zLevels) {
    if (
      level > range.shallowMm + DEPTH_LEVEL_TOLERANCE_MM ||
      level < range.deepMm - DEPTH_LEVEL_TOLERANCE_MM
    )
      continue;
    levels.add(Math.round(level * DEPTH_LEVEL_ROUND) / DEPTH_LEVEL_ROUND);
  }
  return Math.max(1, levels.size);
}

function segmentDepth(model: GcodeRenderModel, index: number): number {
  const base = index * FLOATS_PER_SEGMENT;
  const startZ = model.positions[base + 2] ?? 0;
  const endZ = model.positions[base + 5] ?? 0;
  const kind = model.segKind[index] ?? SEG_KIND.travel;
  if (kind === SEG_KIND.plunge) return endZ;
  if (kind === SEG_KIND.retract) return startZ;
  return Math.min(startZ, endZ);
}

function depthColor(value: number, range: DepthRange): Rgb {
  const span = range.shallowMm - range.deepMm;
  const progress = span <= MIN_DEPTH_SPAN_MM ? 0.5 : clamp01((range.shallowMm - value) / span);
  const mix = (shallow: number, deep: number): number => shallow + (deep - shallow) * progress;
  return [
    mix(DEPTH_RAMP_SHALLOW[0], DEPTH_RAMP_DEEP[0]),
    mix(DEPTH_RAMP_SHALLOW[1], DEPTH_RAMP_DEEP[1]),
    mix(DEPTH_RAMP_SHALLOW[2], DEPTH_RAMP_DEEP[2]),
  ];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
