import {
  cncCoordinateRepresentationMm,
  type CncContourEmissionVertex,
} from '../cnc/coordinate-representation';
import { representedCncCoordinateMm } from '../cnc/coordinate-representation';
import { assertNever, type Vec2 } from '../scene';
import type { CncPass } from './job';

export type CncBoundary = {
  readonly point: Vec2;
  readonly xText: string;
  readonly yText: string;
};

export function cncPassRepresentedExitZMm(pass: CncPass): number {
  switch (pass.kind) {
    case 'contour':
      return representedCncCoordinateMm(pass.zMm);
    case 'path3d':
      return representedCncCoordinateMm(pass.points[pass.points.length - 1]?.z ?? 0);
    case 'arc':
      return representedCncCoordinateMm(pass.zMm);
    case 'helical-contour':
      return representedCncCoordinateMm(pass.zMm);
    default:
      return assertNever(pass, 'CncPass');
  }
}

export function cncPassRepresentedEntry(
  pass: CncPass,
  vertices: ReadonlyArray<CncContourEmissionVertex>,
): CncBoundary | undefined {
  if (pass.kind === 'contour') return vertices[0];
  switch (pass.kind) {
    case 'path3d':
      return ordinaryRepresentedPoint(pass.points[0]);
    case 'arc':
      return ordinaryRepresentedPoint(pass.start);
    case 'helical-contour':
      return ordinaryRepresentedPoint(pass.start);
    default:
      return assertNever(pass, 'CncPass');
  }
}

export function cncPassRepresentedExit(
  pass: CncPass,
  vertices: ReadonlyArray<CncContourEmissionVertex>,
): CncBoundary | undefined {
  if (pass.kind === 'contour') return vertices[vertices.length - 1];
  switch (pass.kind) {
    case 'path3d':
      return ordinaryRepresentedPoint(pass.points[pass.points.length - 1]);
    case 'arc':
      return ordinaryRepresentedPoint(pass.end);
    case 'helical-contour':
      return ordinaryRepresentedPoint(pass.polyline[pass.polyline.length - 1] ?? pass.start);
    default:
      return assertNever(pass, 'CncPass');
  }
}

function ordinaryRepresentedPoint(point: Vec2 | undefined): CncBoundary | undefined {
  if (point === undefined) return undefined;
  const x = cncCoordinateRepresentationMm(point.x);
  const y = cncCoordinateRepresentationMm(point.y);
  return { point: { x: x.value, y: y.value }, xText: x.text, yText: y.text };
}
