import type { CncPass, CncPath3dPass } from '../job';
import type { Vec3 } from '../geometry/vec3';
import {
  CNC_MASK_EMISSION_XY_CLEARANCE_MM,
  representedCncCoordinateMm,
} from '../cnc/cnc-output-precision';
import type { Heightmap } from './heightmap';
import type { Vec2 } from '../scene';

/**
 * Connect equal-height row ends only when a full cutter-cylinder envelope is
 * above every included height cell it can sweep. This deliberately ignores the
 * ball/flank clearance, making the bound conservative for every supported tool.
 * Masked jobs keep their independent entry paths. The new connector's entire
 * envelope must be inside the known domain. Edge approaches retrace exact
 * vertices of the preceding/following row; no new external strip is assumed
 * clear. This does not qualify fixtures or unsampled source detail.
 */
export function linkPlanarReliefRows(
  map: Heightmap,
  passes: ReadonlyArray<CncPass>,
  diameterMm: number,
  maximumRowSpacingMm: number,
  outputXyForPoint: (point: Vec3) => Vec2 = (point) => point,
): ReadonlyArray<CncPass> {
  if (map.inclusion !== undefined || !Number.isFinite(diameterMm) || diameterMm <= 0) return passes;
  return passes.map((pass, index) => {
    const previous = passes[index - 1];
    if (
      previous?.kind !== 'path3d' ||
      pass.kind !== 'path3d' ||
      previous.points.length < 2 ||
      pass.points.length < 2
    )
      return pass;
    return linkedRow(map, previous, pass, diameterMm, maximumRowSpacingMm, outputXyForPoint);
  });
}

function linkedRow(
  map: Heightmap,
  previous: CncPath3dPass,
  pass: CncPath3dPass,
  diameterMm: number,
  maximumRowSpacingMm: number,
  outputXyForPoint: (point: Vec3) => Vec2,
): CncPath3dPass {
  if (
    previous.points.at(-1)?.z !== pass.points[0]?.z ||
    !flatRow(previous.points) ||
    !flatRow(pass.points)
  )
    return pass;
  const radius = diameterMm / 2 + CNC_MASK_EMISSION_XY_CLEARANCE_MM;
  const inset = interiorRowVertex(previous.points, radius, map.widthMm);
  const a = previous.points[inset];
  const nextInset = pass.points.findIndex((point) => point.x === a?.x);
  const b = pass.points[nextInset];
  if (
    a === undefined ||
    b === undefined ||
    !connectorClearsCells(map, a, b, diameterMm, maximumRowSpacingMm, outputXyForPoint)
  )
    return pass;
  // Keep one pass per row (including its recovery boundary). Its entry is now
  // the preceding row end, so ordinary emission recognizes the shared XY and
  // executes the proved connector at cutting feed instead of retracting.
  return {
    ...pass,
    reliefRowLinkPrefixPoints: previous.points.length - inset + nextInset,
    points: [
      ...previous.points.slice(inset).reverse(),
      ...pass.points.slice(0, nextInset + 1).reverse(),
      ...pass.points.slice(1),
    ],
  };
}

function interiorRowVertex(points: ReadonlyArray<Vec3>, radius: number, widthMm: number): number {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point !== undefined && point.x >= radius && point.x <= widthMm - radius) return index;
  }
  return -1;
}

function flatRow(points: ReadonlyArray<Vec3>): boolean {
  const first = points[0];
  return first !== undefined && points.every((point) => point.y === first.y && point.z === first.z);
}

function connectorClearsCells(
  map: Heightmap,
  from: Vec3,
  to: Vec3,
  diameterMm: number,
  maximumRowSpacingMm: number,
  outputXyForPoint: (point: Vec3) => Vec2,
): boolean {
  if (![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)) return false;
  if (!validConnector(from, to, maximumRowSpacingMm)) return false;
  const z = representedCncCoordinateMm(from.z);
  if (!Number.isFinite(z)) return false;
  // The residual placement is an isometry. The norm of each endpoint's actual
  // formatted/GRBL-parsed error bounds the entire interpolated chord's error
  // in local coordinates, including large machine-coordinate float32 effects.
  const uncertainty = Math.max(
    representationError(from, outputXyForPoint),
    representationError(to, outputXyForPoint),
  );
  if (!Number.isFinite(uncertainty)) return false;
  const radius = diameterMm / 2 + Math.max(CNC_MASK_EMISSION_XY_CLEARANCE_MM, uncertainty);
  if (!envelopeInDomain(map, from, to, radius)) return false;
  return cellsBelowLink(map, from, to, radius, z);
}

function validConnector(from: Vec3, to: Vec3, maximumRowSpacingMm: number): boolean {
  return (
    from.x === to.x &&
    from.z === to.z &&
    to.y > from.y &&
    to.y - from.y <= maximumRowSpacingMm + 1e-9
  );
}

function envelopeInDomain(map: Heightmap, from: Vec3, to: Vec3, radius: number): boolean {
  return (
    from.x - radius >= 0 &&
    from.x + radius <= map.widthMm &&
    from.y - radius >= 0 &&
    to.y + radius <= map.heightMm
  );
}

function cellsBelowLink(map: Heightmap, from: Vec3, to: Vec3, radius: number, z: number): boolean {
  // Include a neighbouring sample halo: interpolation between sample centers
  // is bounded by these heights even when the swept band cuts part of a cell.
  const x0 = Math.max(0, Math.floor((from.x - radius) / map.mmPerCell) - 1);
  const x1 = Math.min(map.widthCells - 1, Math.floor((from.x + radius) / map.mmPerCell) + 1);
  const y0 = Math.max(0, Math.floor((from.y - radius) / map.mmPerCell) - 1);
  const y1 = Math.min(map.heightCells - 1, Math.floor((to.y + radius) / map.mmPerCell) + 1);
  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const height = map.depth[row * map.widthCells + col];
      if (height === undefined || !Number.isFinite(height) || height > z) return false;
    }
  }
  return true;
}

function representationError(point: Vec3, outputXyForPoint: (point: Vec3) => Vec2): number {
  const output = outputXyForPoint(point);
  return Math.hypot(
    representedCncCoordinateMm(output.x) - output.x,
    representedCncCoordinateMm(output.y) - output.y,
  );
}
