/**
 * Shared adapters between the T2-15 CompoundPath model and polygon libraries.
 */
import type { MultiPolygon } from 'polygon-clipping';
import {
  compoundPathFromContours,
  makeContour,
  type CompoundFillRule,
  type CompoundPath,
  type ContourRole,
} from '../core/geometry/CompoundPath';

type Coord = [number, number];
type Ring = Coord[];

function ringSignedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function ringAbsArea(ring: Ring): number {
  return Math.abs(ringSignedArea(ring));
}

function pointInRing(p: Coord, ring: Ring): boolean {
  let inside = false;
  const n = ring.length - 1;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = (yi > p[1]) !== (yj > p[1]) &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function reverseRing(ring: Ring): Ring {
  const reversed = ring.slice(0, ring.length - 1).reverse();
  reversed.push([reversed[0][0], reversed[0][1]]);
  return reversed;
}

function ensureWinding(ring: Ring, wantCCW: boolean): Ring {
  const isCCW = ringSignedArea(ring) > 0;
  return isCCW === wantCCW ? ring : reverseRing(ring);
}

function contourToRing(points: CompoundPath['contours'][number]['points']): Ring | null {
  if (points.length < 3) return null;
  const ring = points.map(point => [point.x, point.y] as Coord);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function ringToPoints(ring: readonly Coord[]): Array<{ x: number; y: number }> {
  let coords = ring.map(coord => [coord[0], coord[1]] as Coord);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (coords.length >= 2 && first[0] === last[0] && first[1] === last[1]) {
    coords = coords.slice(0, -1);
  }
  return coords.map(coord => ({ x: coord[0], y: coord[1] }));
}

export function compoundPathToMultiPolygon(path: CompoundPath): MultiPolygon {
  const result: MultiPolygon = [];
  const outers: Array<{ ring: Ring; polygonIndex: number }> = [];
  const pendingHoles: Ring[] = [];

  for (const contour of path.contours) {
    if (!contour.closed || contour.role === 'open') continue;
    const ring = contourToRing(contour.points);
    if (!ring) continue;

    if (contour.role === 'outer' || contour.role === 'island') {
      const outerRing = ensureWinding(ring, /* wantCCW */ true);
      outers.push({ ring: outerRing, polygonIndex: result.length });
      result.push([outerRing]);
    } else if (contour.role === 'hole') {
      pendingHoles.push(ensureWinding(ring, /* wantCCW */ false));
    }
  }

  for (const hole of pendingHoles) {
    const sample = hole[0];
    let best: { ring: Ring; polygonIndex: number } | null = null;
    for (const candidate of outers) {
      if (!pointInRing(sample, candidate.ring)) continue;
      if (!best || ringAbsArea(candidate.ring) < ringAbsArea(best.ring)) {
        best = candidate;
      }
    }

    if (best) {
      result[best.polygonIndex].push(hole);
    } else {
      result.push([ensureWinding(hole, /* wantCCW */ true)]);
    }
  }

  return result;
}

export function multiPolygonToCompoundPath(
  multiPolygon: MultiPolygon,
  sourceObjectId: string,
  fillRule: CompoundFillRule = 'nonzero',
): CompoundPath {
  const contours = [];

  for (const polygon of multiPolygon) {
    for (let i = 0; i < polygon.length; i++) {
      const ring = polygon[i];
      if (!ring || ring.length < 3) continue;
      const role: ContourRole = i === 0 ? 'outer' : 'hole';
      const points = ringToPoints(ring as Ring);
      if (points.length < 3) continue;
      contours.push(makeContour(points, true, role));
    }
  }

  return compoundPathFromContours({
    sourceObjectId,
    contours,
    fillRule,
  });
}
