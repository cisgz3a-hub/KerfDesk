export interface PotracePoint {
  x: number;
  y: number;
}

interface PotraceSum {
  x: number;
  y: number;
  xy: number;
  x2: number;
  y2: number;
}

interface PathState {
  points: readonly PotracePoint[];
  x0: number;
  y0: number;
  sums: PotraceSum[];
}

type Quad = number[];

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function xprod(a: PotracePoint, b: PotracePoint): number {
  return a.x * b.y - a.y * b.x;
}

function cyclic(a: number, b: number, c: number): boolean {
  return a <= c ? a <= b && b < c : a <= b || b < c;
}

function buildPathState(points: readonly PotracePoint[]): PathState {
  const x0 = points[0]?.x ?? 0;
  const y0 = points[0]?.y ?? 0;
  const sums: PotraceSum[] = [{ x: 0, y: 0, xy: 0, x2: 0, y2: 0 }];

  for (let index = 0; index < points.length; index++) {
    const x = points[index].x - x0;
    const y = points[index].y - y0;
    const previous = sums[index];
    sums.push({
      x: previous.x + x,
      y: previous.y + y,
      xy: previous.xy + x * y,
      x2: previous.x2 + x * x,
      y2: previous.y2 + y * y,
    });
  }

  return { points, x0, y0, sums };
}

function segmentPenaltyFromState(state: PathState, start: number, end: number): number {
  const { points, sums } = state;
  const n = points.length;
  if (n === 0) return 0;

  let j = end;
  let wrapped = 0;
  if (j >= n) {
    j -= n;
    wrapped = 1;
  }

  let x: number;
  let y: number;
  let x2: number;
  let xy: number;
  let y2: number;
  let count: number;

  if (wrapped === 0) {
    x = sums[j + 1].x - sums[start].x;
    y = sums[j + 1].y - sums[start].y;
    x2 = sums[j + 1].x2 - sums[start].x2;
    xy = sums[j + 1].xy - sums[start].xy;
    y2 = sums[j + 1].y2 - sums[start].y2;
    count = j + 1 - start;
  } else {
    x = sums[j + 1].x - sums[start].x + sums[n].x;
    y = sums[j + 1].y - sums[start].y + sums[n].y;
    x2 = sums[j + 1].x2 - sums[start].x2 + sums[n].x2;
    xy = sums[j + 1].xy - sums[start].xy + sums[n].xy;
    y2 = sums[j + 1].y2 - sums[start].y2 + sums[n].y2;
    count = j + 1 - start + n;
  }

  const midpointX = (points[start].x + points[j].x) / 2 - state.x0;
  const midpointY = (points[start].y + points[j].y) / 2 - state.y0;
  const normalY = points[j].x - points[start].x;
  const normalX = -(points[j].y - points[start].y);
  const a = (x2 - 2 * x * midpointX) / count + midpointX * midpointX;
  const b = (xy - x * midpointY - y * midpointX) / count + midpointX * midpointY;
  const c = (y2 - 2 * y * midpointY) / count + midpointY * midpointY;
  const penalty = normalX * normalX * a + 2 * normalX * normalY * b + normalY * normalY * c;

  return Math.sqrt(Math.max(0, penalty));
}

export function potraceSegmentPenalty(
  points: readonly PotracePoint[],
  start: number,
  end: number,
): number {
  return segmentPenaltyFromState(buildPathState(points), start, end);
}

function directionIndex(dx: number, dy: number): number {
  return (3 + 3 * sign(dx) + sign(dy)) / 2;
}

export function calculatePotraceLongestStraightSegments(points: readonly PotracePoint[]): number[] {
  const n = points.length;
  if (n === 0) return [];

  const pivot = new Array<number>(n).fill(0);
  const nextCorner = new Array<number>(n).fill(0);
  const lon = new Array<number>(n).fill(0);
  let k = 0;

  for (let i = n - 1; i >= 0; i--) {
    if (points[i].x !== points[k].x && points[i].y !== points[k].y) {
      k = i + 1;
    }
    nextCorner[i] = k;
  }

  for (let i = n - 1; i >= 0; i--) {
    const directionCounts = [0, 0, 0, 0];
    const next = points[mod(i + 1, n)];
    directionCounts[directionIndex(next.x - points[i].x, next.y - points[i].y)]++;

    const constraints = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    const current = { x: 0, y: 0 };
    const offset = { x: 0, y: 0 };
    const direction = { x: 0, y: 0 };
    let foundPivot = false;
    k = nextCorner[i];
    let previousK = i;

    while (true) {
      const stepDirection = directionIndex(
        points[k].x - points[previousK].x,
        points[k].y - points[previousK].y,
      );
      directionCounts[stepDirection]++;

      if (directionCounts.every(count => count > 0)) {
        pivot[i] = previousK;
        foundPivot = true;
        break;
      }

      current.x = points[k].x - points[i].x;
      current.y = points[k].y - points[i].y;
      if (xprod(constraints[0], current) < 0 || xprod(constraints[1], current) > 0) {
        break;
      }

      if (Math.abs(current.x) > 1 || Math.abs(current.y) > 1) {
        offset.x = current.x + (current.y >= 0 && (current.y > 0 || current.x < 0) ? 1 : -1);
        offset.y = current.y + (current.x <= 0 && (current.x < 0 || current.y < 0) ? 1 : -1);
        if (xprod(constraints[0], offset) >= 0) {
          constraints[0] = { ...offset };
        }

        offset.x = current.x + (current.y <= 0 && (current.y < 0 || current.x < 0) ? 1 : -1);
        offset.y = current.y + (current.x >= 0 && (current.x > 0 || current.y < 0) ? 1 : -1);
        if (xprod(constraints[1], offset) <= 0) {
          constraints[1] = { ...offset };
        }
      }

      previousK = k;
      k = nextCorner[previousK];
      if (!cyclic(k, i, previousK)) {
        break;
      }
    }

    if (!foundPivot) {
      direction.x = sign(points[k].x - points[previousK].x);
      direction.y = sign(points[k].y - points[previousK].y);
      current.x = points[previousK].x - points[i].x;
      current.y = points[previousK].y - points[i].y;

      const a = xprod(constraints[0], current);
      const b = xprod(constraints[0], direction);
      const c = xprod(constraints[1], current);
      const d = xprod(constraints[1], direction);
      let advance = 10_000_000;
      if (b < 0) {
        advance = Math.floor(a / -b);
      }
      if (d > 0) {
        advance = Math.min(advance, Math.floor(-c / d));
      }
      pivot[i] = mod(previousK + advance, n);
    }
  }

  let j = pivot[n - 1];
  lon[n - 1] = j;
  for (let i = n - 2; i >= 0; i--) {
    if (cyclic(i + 1, pivot[i], j)) {
      j = pivot[i];
    }
    lon[i] = j;
  }

  for (let i = n - 1; cyclic(mod(i + 1, n), j, lon[i]); i--) {
    lon[i] = j;
  }

  return lon;
}

export function calculateBestPotracePolygon(
  points: readonly PotracePoint[],
  longestStraightSegments = calculatePotraceLongestStraightSegments(points),
): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, index) => index);

  const state = buildPathState(points);
  const penalty = new Array<number>(n + 1).fill(0);
  const previous = new Array<number>(n + 1).fill(0);
  const clip0 = new Array<number>(n).fill(0);
  const clip1 = new Array<number>(n + 1).fill(0);
  const segment0 = new Array<number>(n + 1).fill(0);
  const segment1 = new Array<number>(n + 1).fill(0);

  for (let i = 0; i < n; i++) {
    let clip = mod(longestStraightSegments[mod(i - 1, n)] - 1, n);
    if (clip === i) {
      clip = mod(i + 1, n);
    }
    clip0[i] = clip < i ? n : clip;
  }

  let j = 1;
  for (let i = 0; i < n; i++) {
    while (j <= clip0[i]) {
      clip1[j] = i;
      j++;
    }
  }

  let i = 0;
  for (j = 0; i < n; j++) {
    segment0[j] = i;
    i = clip0[i];
  }
  segment0[j] = n;
  const segmentCount = j;

  i = n;
  for (j = segmentCount; j > 0; j--) {
    segment1[j] = i;
    i = clip1[i];
  }
  segment1[0] = 0;

  penalty[0] = 0;
  for (j = 1; j <= segmentCount; j++) {
    for (i = segment1[j]; i <= segment0[j]; i++) {
      let best = -1;
      for (let k = segment0[j - 1]; k >= clip1[i]; k--) {
        const currentPenalty = segmentPenaltyFromState(state, k, i) + penalty[k];
        if (best < 0 || currentPenalty < best) {
          previous[i] = k;
          best = currentPenalty;
        }
      }
      penalty[i] = best;
    }
  }

  const polygon = new Array<number>(segmentCount);
  for (i = n, j = segmentCount - 1; i > 0; j--) {
    i = previous[i];
    polygon[j] = i;
  }

  return polygon;
}

function pointslope(
  state: PathState,
  start: number,
  end: number,
): { center: PotracePoint; direction: PotracePoint } {
  const n = state.points.length;
  let i = start;
  let j = end;
  let rotations = 0;

  while (j >= n) {
    j -= n;
    rotations++;
  }
  while (i >= n) {
    i -= n;
    rotations--;
  }
  while (j < 0) {
    j += n;
    rotations--;
  }
  while (i < 0) {
    i += n;
    rotations++;
  }

  const x = state.sums[j + 1].x - state.sums[i].x + rotations * state.sums[n].x;
  const y = state.sums[j + 1].y - state.sums[i].y + rotations * state.sums[n].y;
  const x2 = state.sums[j + 1].x2 - state.sums[i].x2 + rotations * state.sums[n].x2;
  const xy = state.sums[j + 1].xy - state.sums[i].xy + rotations * state.sums[n].xy;
  const y2 = state.sums[j + 1].y2 - state.sums[i].y2 + rotations * state.sums[n].y2;
  const count = j + 1 - i + rotations * n;
  const center = { x: x / count, y: y / count };
  let a = (x2 - x * x / count) / count;
  const b = (xy - x * y / count) / count;
  let c = (y2 - y * y / count) / count;
  const lambda = (a + c + Math.sqrt((a - c) * (a - c) + 4 * b * b)) / 2;
  a -= lambda;
  c -= lambda;

  let length: number;
  const direction = { x: 0, y: 0 };
  if (Math.abs(a) >= Math.abs(c)) {
    length = Math.sqrt(a * a + b * b);
    if (length !== 0) {
      direction.x = -b / length;
      direction.y = a / length;
    }
  } else {
    length = Math.sqrt(c * c + b * b);
    if (length !== 0) {
      direction.x = -c / length;
      direction.y = b / length;
    }
  }

  return { center, direction };
}

function emptyQuad(): Quad {
  return new Array<number>(9).fill(0);
}

function quadAt(quad: Quad, row: number, column: number): number {
  return quad[row * 3 + column];
}

function quadForm(quad: Quad, point: PotracePoint): number {
  return (
    quadAt(quad, 0, 0) * point.x * point.x +
    (quadAt(quad, 0, 1) + quadAt(quad, 1, 0)) * point.x * point.y +
    (quadAt(quad, 0, 2) + quadAt(quad, 2, 0)) * point.x +
    quadAt(quad, 1, 1) * point.y * point.y +
    (quadAt(quad, 1, 2) + quadAt(quad, 2, 1)) * point.y +
    quadAt(quad, 2, 2)
  );
}

export function adjustPotraceVertices(
  points: readonly PotracePoint[],
  polygonIndices: readonly number[],
): PotracePoint[] {
  const n = points.length;
  const m = polygonIndices.length;
  if (n === 0 || m === 0) return [];

  const state = buildPathState(points);
  const lineQuadrics: Quad[] = new Array(m);
  const centers: PotracePoint[] = new Array(m);
  const directions: PotracePoint[] = new Array(m);

  for (let i = 0; i < m; i++) {
    const nextIndex = polygonIndices[mod(i + 1, m)];
    const unwrappedNext = mod(nextIndex - polygonIndices[i], n) + polygonIndices[i];
    const slope = pointslope(state, polygonIndices[i], unwrappedNext);
    centers[i] = slope.center;
    directions[i] = slope.direction;
  }

  for (let i = 0; i < m; i++) {
    const quad = emptyQuad();
    const direction = directions[i];
    const magnitude = direction.x * direction.x + direction.y * direction.y;

    if (magnitude !== 0) {
      const vector = [
        direction.y,
        -direction.x,
        direction.x * centers[i].y - direction.y * centers[i].x,
      ];

      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
          quad[row * 3 + column] = vector[row] * vector[column] / magnitude;
        }
      }
    }

    lineQuadrics[i] = quad;
  }

  const vertices: PotracePoint[] = new Array(m);
  const vector = [0, 0, 0];
  const raw = { x: 0, y: 0 };
  const candidate = { x: 0, y: 0 };

  for (let i = 0; i < m; i++) {
    const quad = emptyQuad();
    const previous = mod(i - 1, m);
    raw.x = points[polygonIndices[i]].x - state.x0;
    raw.y = points[polygonIndices[i]].y - state.y0;

    for (let index = 0; index < 9; index++) {
      quad[index] = lineQuadrics[previous][index] + lineQuadrics[i][index];
    }

    while (true) {
      const determinant = quadAt(quad, 0, 0) * quadAt(quad, 1, 1)
        - quadAt(quad, 0, 1) * quadAt(quad, 1, 0);
      if (determinant !== 0) {
        candidate.x = (-quadAt(quad, 0, 2) * quadAt(quad, 1, 1)
          + quadAt(quad, 1, 2) * quadAt(quad, 0, 1)) / determinant;
        candidate.y = (quadAt(quad, 0, 2) * quadAt(quad, 1, 0)
          - quadAt(quad, 1, 2) * quadAt(quad, 0, 0)) / determinant;
        break;
      }

      if (quadAt(quad, 0, 0) > quadAt(quad, 1, 1)) {
        vector[0] = -quadAt(quad, 0, 1);
        vector[1] = quadAt(quad, 0, 0);
      } else if (quadAt(quad, 1, 1) !== 0) {
        vector[0] = -quadAt(quad, 1, 1);
        vector[1] = quadAt(quad, 1, 0);
      } else {
        vector[0] = 1;
        vector[1] = 0;
      }

      const magnitude = vector[0] * vector[0] + vector[1] * vector[1];
      vector[2] = -vector[1] * raw.y - vector[0] * raw.x;
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
          quad[row * 3 + column] += vector[row] * vector[column] / magnitude;
        }
      }
    }

    const dx = Math.abs(candidate.x - raw.x);
    const dy = Math.abs(candidate.y - raw.y);
    if (dx <= 0.5 && dy <= 0.5) {
      vertices[i] = { x: candidate.x + state.x0, y: candidate.y + state.y0 };
      continue;
    }

    let minimum = quadForm(quad, raw);
    let bestX = raw.x;
    let bestY = raw.y;

    if (quadAt(quad, 0, 0) !== 0) {
      for (let z = 0; z < 2; z++) {
        candidate.y = raw.y - 0.5 + z;
        candidate.x = -(quadAt(quad, 0, 1) * candidate.y + quadAt(quad, 0, 2)) / quadAt(quad, 0, 0);
        const candidateDx = Math.abs(candidate.x - raw.x);
        const candidatePenalty = quadForm(quad, candidate);
        if (candidateDx <= 0.5 && candidatePenalty < minimum) {
          minimum = candidatePenalty;
          bestX = candidate.x;
          bestY = candidate.y;
        }
      }
    }

    if (quadAt(quad, 1, 1) !== 0) {
      for (let z = 0; z < 2; z++) {
        candidate.x = raw.x - 0.5 + z;
        candidate.y = -(quadAt(quad, 1, 0) * candidate.x + quadAt(quad, 1, 2)) / quadAt(quad, 1, 1);
        const candidateDy = Math.abs(candidate.y - raw.y);
        const candidatePenalty = quadForm(quad, candidate);
        if (candidateDy <= 0.5 && candidatePenalty < minimum) {
          minimum = candidatePenalty;
          bestX = candidate.x;
          bestY = candidate.y;
        }
      }
    }

    for (let xIndex = 0; xIndex < 2; xIndex++) {
      for (let yIndex = 0; yIndex < 2; yIndex++) {
        candidate.x = raw.x - 0.5 + xIndex;
        candidate.y = raw.y - 0.5 + yIndex;
        const candidatePenalty = quadForm(quad, candidate);
        if (candidatePenalty < minimum) {
          minimum = candidatePenalty;
          bestX = candidate.x;
          bestY = candidate.y;
        }
      }
    }

    vertices[i] = { x: bestX + state.x0, y: bestY + state.y0 };
  }

  return vertices;
}
