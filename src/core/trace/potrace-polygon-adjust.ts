import {
  buildPathState,
  emptyQuad,
  mod,
  pointAt,
  pointslope,
  quadAt,
  quadForm,
  type PathState,
  type PotracePoint,
  type Quad,
} from './potrace-polygon-core';

type FitLines = {
  readonly centers: readonly PotracePoint[];
  readonly directions: readonly PotracePoint[];
};

type BestPoint = {
  readonly x: number;
  readonly y: number;
  readonly penalty: number;
};

export function adjustPotraceVertices(
  points: readonly PotracePoint[],
  polygonIndices: readonly number[],
): PotracePoint[] {
  const n = points.length;
  const m = polygonIndices.length;
  if (n === 0 || m === 0) return [];

  const state = buildPathState(points);
  const lineQuadrics = buildLineQuadrics(state, polygonIndices);
  const vertices: PotracePoint[] = [];

  for (let i = 0; i < m; i += 1) {
    vertices.push(adjustVertex(state, polygonIndices, lineQuadrics, i));
  }
  return vertices;
}

function buildLineFits(state: PathState, polygonIndices: readonly number[]): FitLines {
  const n = state.points.length;
  const m = polygonIndices.length;
  const centers: PotracePoint[] = [];
  const directions: PotracePoint[] = [];

  for (let i = 0; i < m; i += 1) {
    const polygonIndex = polygonIndices[i] ?? 0;
    const nextIndex = polygonIndices[mod(i + 1, m)] ?? 0;
    const unwrappedNext = mod(nextIndex - polygonIndex, n) + polygonIndex;
    const slope = pointslope(state, polygonIndex, unwrappedNext);
    centers.push(slope.center);
    directions.push(slope.direction);
  }

  return { centers, directions };
}

function buildLineQuadrics(state: PathState, polygonIndices: readonly number[]): Quad[] {
  const fits = buildLineFits(state, polygonIndices);
  const lineQuadrics: Quad[] = [];

  for (let i = 0; i < polygonIndices.length; i += 1) {
    lineQuadrics.push(lineQuad(pointAt(fits.directions, i), pointAt(fits.centers, i)));
  }
  return lineQuadrics;
}

function lineQuad(direction: PotracePoint, center: PotracePoint): Quad {
  const quad = emptyQuad();
  const magnitude = direction.x * direction.x + direction.y * direction.y;
  if (magnitude === 0) return quad;

  const vector = [direction.y, -direction.x, direction.x * center.y - direction.y * center.x];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      quad[row * 3 + column] = ((vector[row] ?? 0) * (vector[column] ?? 0)) / magnitude;
    }
  }
  return quad;
}

function adjustVertex(
  state: PathState,
  polygonIndices: readonly number[],
  lineQuadrics: readonly Quad[],
  i: number,
): PotracePoint {
  const raw = rawVertex(state, polygonIndices, i);
  const quad = combinedQuad(lineQuadrics, i);
  const candidate = solveQuad(quad, raw);
  if (insideRawCell(candidate, raw)) {
    return { x: candidate.x + state.x0, y: candidate.y + state.y0 };
  }

  const best = bestConstrainedPoint(quad, raw);
  return { x: best.x + state.x0, y: best.y + state.y0 };
}

function rawVertex(state: PathState, polygonIndices: readonly number[], i: number): PotracePoint {
  const rawPoint = pointAt(state.points, polygonIndices[i] ?? 0);
  return { x: rawPoint.x - state.x0, y: rawPoint.y - state.y0 };
}

function combinedQuad(lineQuadrics: readonly Quad[], i: number): Quad {
  const m = lineQuadrics.length;
  const quad = emptyQuad();
  const previous = mod(i - 1, m);
  for (let index = 0; index < 9; index += 1) {
    quad[index] = (lineQuadrics[previous]?.[index] ?? 0) + (lineQuadrics[i]?.[index] ?? 0);
  }
  return quad;
}

function solveQuad(quad: Quad, raw: PotracePoint): PotracePoint {
  const candidate = { x: 0, y: 0 };
  while (true) {
    const determinant =
      quadAt(quad, 0, 0) * quadAt(quad, 1, 1) - quadAt(quad, 0, 1) * quadAt(quad, 1, 0);
    if (determinant !== 0) {
      candidate.x =
        (-quadAt(quad, 0, 2) * quadAt(quad, 1, 1) + quadAt(quad, 1, 2) * quadAt(quad, 0, 1)) /
        determinant;
      candidate.y =
        (quadAt(quad, 0, 2) * quadAt(quad, 1, 0) - quadAt(quad, 1, 2) * quadAt(quad, 0, 0)) /
        determinant;
      return candidate;
    }
    addFallbackLine(quad, raw);
  }
}

function addFallbackLine(quad: Quad, raw: PotracePoint): void {
  const vector = fallbackVector(quad, raw);
  const magnitude = vector[0] * vector[0] + vector[1] * vector[1];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      quad[row * 3 + column] =
        (quad[row * 3 + column] ?? 0) + ((vector[row] ?? 0) * (vector[column] ?? 0)) / magnitude;
    }
  }
}

function fallbackVector(quad: Quad, raw: PotracePoint): [number, number, number] {
  let x = 1;
  let y = 0;
  if (quadAt(quad, 0, 0) > quadAt(quad, 1, 1)) {
    x = -quadAt(quad, 0, 1);
    y = quadAt(quad, 0, 0);
  } else if (quadAt(quad, 1, 1) !== 0) {
    x = -quadAt(quad, 1, 1);
    y = quadAt(quad, 1, 0);
  }
  return [x, y, -y * raw.y - x * raw.x];
}

function insideRawCell(candidate: PotracePoint, raw: PotracePoint): boolean {
  return Math.abs(candidate.x - raw.x) <= 0.5 && Math.abs(candidate.y - raw.y) <= 0.5;
}

function bestConstrainedPoint(quad: Quad, raw: PotracePoint): BestPoint {
  let best = { x: raw.x, y: raw.y, penalty: quadForm(quad, raw) };
  best = bestHorizontalEdgePoint(quad, raw, best);
  best = bestVerticalEdgePoint(quad, raw, best);
  return bestCornerPoint(quad, raw, best);
}

function bestHorizontalEdgePoint(quad: Quad, raw: PotracePoint, best: BestPoint): BestPoint {
  if (quadAt(quad, 0, 0) === 0) return best;
  let nextBest = best;
  for (let z = 0; z < 2; z += 1) {
    const y = raw.y - 0.5 + z;
    const x = -(quadAt(quad, 0, 1) * y + quadAt(quad, 0, 2)) / quadAt(quad, 0, 0);
    nextBest = chooseBetter(quad, raw, { x, y }, 'x', nextBest);
  }
  return nextBest;
}

function bestVerticalEdgePoint(quad: Quad, raw: PotracePoint, best: BestPoint): BestPoint {
  if (quadAt(quad, 1, 1) === 0) return best;
  let nextBest = best;
  for (let z = 0; z < 2; z += 1) {
    const x = raw.x - 0.5 + z;
    const y = -(quadAt(quad, 1, 0) * x + quadAt(quad, 1, 2)) / quadAt(quad, 1, 1);
    nextBest = chooseBetter(quad, raw, { x, y }, 'y', nextBest);
  }
  return nextBest;
}

function bestCornerPoint(quad: Quad, raw: PotracePoint, best: BestPoint): BestPoint {
  let nextBest = best;
  for (let xIndex = 0; xIndex < 2; xIndex += 1) {
    for (let yIndex = 0; yIndex < 2; yIndex += 1) {
      nextBest = chooseBetter(
        quad,
        raw,
        { x: raw.x - 0.5 + xIndex, y: raw.y - 0.5 + yIndex },
        'both',
        nextBest,
      );
    }
  }
  return nextBest;
}

function chooseBetter(
  quad: Quad,
  raw: PotracePoint,
  candidate: PotracePoint,
  axis: 'x' | 'y' | 'both',
  best: BestPoint,
): BestPoint {
  if (!candidateWithinAxis(candidate, raw, axis)) return best;
  const penalty = quadForm(quad, candidate);
  return penalty < best.penalty ? { ...candidate, penalty } : best;
}

function candidateWithinAxis(
  candidate: PotracePoint,
  raw: PotracePoint,
  axis: 'x' | 'y' | 'both',
): boolean {
  if (axis === 'x') return Math.abs(candidate.x - raw.x) <= 0.5;
  if (axis === 'y') return Math.abs(candidate.y - raw.y) <= 0.5;
  return true;
}
