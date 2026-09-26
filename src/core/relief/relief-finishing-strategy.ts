// Relief finishing strategies (ADR-423).
//
// 'raster' is the H.8 serpentine along one axis at the scallop's row spacing
// (ADR-421): the scallop holds on flats, grows on slopes across the rows, and
// a wall parallel to the rows is never touched.
//
// 'raster-waterline' splits the part at the steep angle. Waterline passes
// (relief-waterline.ts) finish every slope at or above it with levels
// rowSpacing x sin(angle) apart; the raster finishes the rest with rows
// rowSpacing x cos(angle) apart. On a slope phi below the angle, rows that far
// apart lie at most rowSpacing apart along the surface, and on a slope above
// it the levels do too, so passes are never further apart along the surface
// than the scallop's row spacing anywhere on the part.
//
// The raster may run along Y instead of X: the planner then runs on the
// transposed map and swaps the coordinates back.

import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import {
  reliefFinishingPasses,
  scallopRowSpacingMm,
  type ReliefFinishingOptions,
} from './relief-finishing';
import { reliefWaterlinePasses } from './relief-waterline';

export type ReliefFinishStrategy = 'raster' | 'raster-waterline';
export type ReliefRasterAxis = 'x' | 'y';

export const RELIEF_FINISH_STRATEGIES: ReadonlyArray<ReliefFinishStrategy> = [
  'raster',
  'raster-waterline',
];
export const RELIEF_RASTER_AXES: ReadonlyArray<ReliefRasterAxis> = ['x', 'y'];

/** Slopes at or above this angle are finished by waterline passes. */
export const RELIEF_STEEP_ANGLE_DEG = 45;
// Longest stay-down link between waterline passes, in bit diameters.
const WATERLINE_LINK_DIAMETERS = 2;

const STEEP_ANGLE_RAD = (RELIEF_STEEP_ANGLE_DEG * Math.PI) / 180;

/** The raster's row spacing: the scallop's, closer under 'raster-waterline'. */
export function reliefFinishRowSpacingMm(
  tool: CncTool,
  scallopMm: number,
  strategy: ReliefFinishStrategy,
): number {
  const rowSpacingMm = scallopRowSpacingMm(tool, scallopMm);
  return strategy === 'raster-waterline' ? rowSpacingMm * Math.cos(STEEP_ANGLE_RAD) : rowSpacingMm;
}

export type ReliefFinishingPlanOptions = Omit<ReliefFinishingOptions, 'rowSpacingMm'> & {
  readonly strategy: ReliefFinishStrategy;
  readonly rasterAxis: ReliefRasterAxis;
  // Waterline direction in map numbers: true keeps the wall right of travel.
  readonly wallOnRight: boolean;
};

/** Raster passes, then (under 'raster-waterline') the waterline passes. */
export function reliefFinishingPlan(
  map: Heightmap,
  options: ReliefFinishingPlanOptions,
): ReadonlyArray<CncPass> {
  const rowSpacingMm = reliefFinishRowSpacingMm(options.tool, options.scallopMm, options.strategy);
  const waterline = options.strategy === 'raster-waterline' && map.inclusion?.includes(0) !== true;
  // The waterline contours the whole tip surface; the raster then reads its
  // rows from the same field instead of computing them again.
  const tip = waterline ? dilateHeightmapByTool(withoutMask(map), options.kernel, 0) : undefined;
  const rasterOptions = {
    tool: options.tool,
    kernel: options.kernel,
    scallopMm: options.scallopMm,
    rowSpacingMm,
  };
  const raster =
    options.rasterAxis === 'y'
      ? transposedPasses(
          reliefFinishingPasses(transposeHeightmap(map), {
            ...rasterOptions,
            ...(tip === undefined
              ? {}
              : { tip: transposeCells(tip, map.widthCells, map.heightCells) }),
          }),
        )
      : reliefFinishingPasses(map, { ...rasterOptions, ...(tip === undefined ? {} : { tip }) });
  if (tip === undefined) return raster;
  const levelStepMm =
    scallopRowSpacingMm(options.tool, options.scallopMm) * Math.sin(STEEP_ANGLE_RAD);
  return [
    ...raster,
    ...reliefWaterlinePasses(map, tip, {
      kernel: options.kernel,
      steepAngleDeg: RELIEF_STEEP_ANGLE_DEG,
      levelStepMm,
      wallOnRight: options.wallOnRight,
      maxLinkMm: WATERLINE_LINK_DIAMETERS * options.tool.diameterMm,
    }),
  ];
}

// A mask that excludes nothing plans exactly as no mask.
function withoutMask(map: Heightmap): Heightmap {
  const { inclusion: _allIncluded, ...unmasked } = map;
  return unmasked;
}

export function transposeHeightmap(map: Heightmap): Heightmap {
  const { inclusion, ...rest } = map;
  return {
    ...rest,
    widthCells: map.heightCells,
    heightCells: map.widthCells,
    widthMm: map.heightMm,
    heightMm: map.widthMm,
    depth: transposeCells(map.depth, map.widthCells, map.heightCells),
    ...(inclusion === undefined
      ? {}
      : { inclusion: transposeCells(inclusion, map.widthCells, map.heightCells) }),
  };
}

function transposeCells<T extends Float32Array | Uint8Array>(
  cells: T,
  widthCells: number,
  heightCells: number,
): T {
  const out = cells.slice() as T;
  for (let j = 0; j < heightCells; j += 1) {
    for (let i = 0; i < widthCells; i += 1)
      out[i * heightCells + j] = cells[j * widthCells + i] ?? 0;
  }
  return out;
}

function transposedPasses(passes: ReadonlyArray<CncPass>): ReadonlyArray<CncPass> {
  return passes.map((pass) =>
    pass.kind === 'path3d'
      ? { ...pass, points: pass.points.map((point) => ({ x: point.y, y: point.x, z: point.z })) }
      : pass,
  );
}
