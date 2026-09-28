// Waterline finishing for steep walls (ADR-423). A raster rides the relief in
// rows, so on a wall the rows climb or drop steeply and their spacing across
// the wall grows with its slope; on a wall parallel to the rows the bit never
// touches the face at all. Waterline passes instead circle the wall at fixed
// heights, like Fusion's Contour, Carveco's Constant Z or MeshCAM's Waterline.
//
// Where the tip surface T slopes at the steep angle or more, the squares that
// touch it are the waterline region. Levels are spaced `levelStepMm` apart,
// anchored at stock top so neighbouring features share them, and each level's
// contour of T through the region becomes one pass per contour: vertices at
// the exact contact (relief-waterline-contours.ts), moves checked and reduced
// (relief-waterline-path.ts), then ordered and linked
// (relief-waterline-order.ts).
//
// On a slope phi, levels dz apart lie dz / sin(phi) apart along the surface.
// With dz = rowSpacing x sin(steep angle), every slope at or above the steep
// angle is covered at no more than the row spacing, the same across-pass
// spacing the raster keeps on the shallow slopes it covers.
//
// A masked map's excluded stock stands as blocks the contours ride round like
// any wall (ADR-484, relief-mask-stock.ts). Every waterline move is level and
// checked a quarter cell apart, beside the wall; the blocks keep the cutter
// off by the dilation's clearance plus half that spacing and that reach, so
// no point of a move comes nearer than a checked one allows.

import type { CncPath3dPass } from '../job';
import type { ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField, type SurfaceContactField } from './heightmap-surface-contact';
import { FINISHING_REDUCTION_TOLERANCE_MM } from './relief-finishing-path';
import { createMaskStock, type MaskStock, raisedOverStock } from './relief-mask-stock';
import { waterlineContours, type WaterlineSurface } from './relief-waterline-contours';
import { orderWaterlinePaths, type WaterlineLevelPath } from './relief-waterline-order';
import { WALL_REACH_MM, waterlinePath } from './relief-waterline-path';

// Floating-point slack on "the tip clears z": far below the 0.001 mm emit grid.
const CLEARANCE_SLACK_MM = 1e-6;

export type ReliefWaterlineOptions = {
  readonly kernel: ToolKernel;
  // Slopes at or above this angle (degrees) are waterline territory.
  readonly steepAngleDeg: number;
  readonly levelStepMm: number;
  // In map numbers: true puts the wall on the right of travel.
  readonly wallOnRight: boolean;
  // Longest stay-down link between two passes, in XY.
  readonly maxLinkMm: number;
};

/**
 * Waterline passes over the steep part of the map's tip surface: `dilated`,
 * its zero-allowance dilation with the map's mask, raised over excluded stock.
 */
export function reliefWaterlinePasses(
  map: Heightmap,
  dilated: Float32Array,
  options: ReliefWaterlineOptions,
): ReadonlyArray<CncPath3dPass> {
  if (!(options.levelStepMm > 0)) return [];
  const contact = createSurfaceContactField(map, options.kernel);
  if (contact === null) return [];
  const checkSpacingMm = map.mmPerCell / 4;
  const stock = createMaskStock(
    map,
    options.kernel,
    options.kernel.maskPathUncertaintyMm + checkSpacingMm / 2 + WALL_REACH_MM,
  );
  const surface = waterlineSurface(contact, stock);
  const tip = stock === null ? dilated : raisedOverStock(map, dilated, stock);
  const steep = steepSamples(map, tip, Math.tan((options.steepAngleDeg * Math.PI) / 180));
  const region = squaresTouching(map, steep.flags);
  if (!steep.any) return [];
  const paths: WaterlineLevelPath[] = [];
  const firstLevel = Math.floor(-steep.maxTip / options.levelStepMm) + 1;
  for (let k = Math.max(1, firstLevel); -k * options.levelStepMm > steep.minTip; k += 1) {
    const z = -k * options.levelStepMm;
    for (const contour of waterlineContours(map, tip, z, region, surface)) {
      const points = waterlinePath(contour.points, contour.closed, {
        z,
        surface,
        checkSpacingMm,
        toleranceMm: FINISHING_REDUCTION_TOLERANCE_MM,
      });
      if (points.length < 2) continue;
      paths.push({
        level: k,
        closed: contour.closed,
        points: options.wallOnRight ? points : [...points].reverse(),
      });
    }
  }
  return orderWaterlinePaths(paths, {
    surface,
    maxLinkMm: options.maxLinkMm,
    checkSpacingMm,
  });
}

function waterlineSurface(contact: SurfaceContactField, stock: MaskStock | null): WaterlineSurface {
  // Asking with z as the floor lets the contact prune every element that
  // cannot reach z, which is most of them.
  const surfaceClears = (x: number, y: number, z: number): boolean =>
    contact.clearsAtPoint(x, y, z, CLEARANCE_SLACK_MM);
  const surfaceTip = (x: number, y: number): number =>
    contact.constraintAtPoint(x, y, Number.NEGATIVE_INFINITY);
  if (stock === null) return { clears: surfaceClears, tipAt: surfaceTip };
  return {
    clears: (x, y, z) => stock.tipAt(x, y) <= z && surfaceClears(x, y, z),
    tipAt: (x, y) => Math.max(stock.tipAt(x, y), surfaceTip(x, y)),
  };
}

// Samples whose tip-surface slope reaches the steep angle, by central
// differences (one-sided at the map edge), plus the tip range they span.
function steepSamples(
  map: Heightmap,
  tip: Float32Array,
  steepSlope: number,
): {
  readonly flags: Uint8Array;
  readonly any: boolean;
  readonly minTip: number;
  readonly maxTip: number;
} {
  const { widthCells, heightCells } = map;
  const flags = new Uint8Array(widthCells * heightCells);
  let minTip = Number.POSITIVE_INFINITY;
  let maxTip = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < heightCells; j += 1) {
    for (let i = 0; i < widthCells; i += 1) {
      const gx = difference(map, tip, i, j, 1, 0);
      const gy = difference(map, tip, i, j, 0, 1);
      if (gx * gx + gy * gy < steepSlope * steepSlope) continue;
      const index = j * widthCells + i;
      flags[index] = 1;
      minTip = Math.min(minTip, tip[index] ?? 0);
      maxTip = Math.max(maxTip, tip[index] ?? 0);
    }
  }
  return { flags, any: minTip <= maxTip, minTip, maxTip };
}

function difference(
  map: Heightmap,
  tip: Float32Array,
  i: number,
  j: number,
  di: number,
  dj: number,
): number {
  const lastI = Math.min(map.widthCells - 1, i + di);
  const lastJ = Math.min(map.heightCells - 1, j + dj);
  const firstI = Math.max(0, i - di);
  const firstJ = Math.max(0, j - dj);
  const steps = lastI - firstI + (lastJ - firstJ);
  if (steps === 0) return 0;
  const high = tip[lastJ * map.widthCells + lastI] ?? 0;
  const low = tip[firstJ * map.widthCells + firstI] ?? 0;
  return (high - low) / (steps * map.mmPerCell);
}

// A square (by its top-left sample) joins the region when any corner is steep.
function squaresTouching(map: Heightmap, flags: Uint8Array): Uint8Array {
  const { widthCells, heightCells } = map;
  const region = new Uint8Array(widthCells * heightCells);
  for (let j = 0; j + 1 < heightCells; j += 1) {
    for (let i = 0; i + 1 < widthCells; i += 1) {
      const top = j * widthCells + i;
      const bottom = top + widthCells;
      if (flags[top] || flags[top + 1] || flags[bottom] || flags[bottom + 1]) region[top] = 1;
    }
  }
  return region;
}
