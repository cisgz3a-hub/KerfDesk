// One straight move against one excluded block (ADR-482).
//
// A block is an excluded cell's rectangle, standing `top` high, which the
// cutter keeps `clearanceMm` off in XY. Along a straight move the distance
// d(t) from the cutter's axis to the rectangle is convex in t, and every
// cutter law dz is convex and nondecreasing in radius, so while the block is
// in reach the move's height above what the block requires,
//
//   h(t) = z(t) - (top - dz(d(t) - clearance)),
//
// is convex: a linear z less a concave requirement. Outside reach the block
// requires nothing, and at the edge of reach the requirement drops away
// (the cutter's rim clears the block's side), so the lowest point may sit
// right at that edge. The part of the move in reach is one stretch, since
// d(t) is convex; it is found first by bisection from the move's nearest
// point, and h is searched over that stretch only, ends included, by
// golden-section search.

export type BlockLaw = {
  readonly top: number;
  readonly clearanceMm: number;
  readonly radiusMm: number;
  // radiusMm + clearanceMm, with a little floating-point room.
  readonly reachMm: number;
  readonly dz: (radiusMm: number) => number;
};

export type Rectangle = {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
};

export type Move = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
};

export type BlockExcess = {
  // Where along the move (0 to 1) it stands lowest against the block.
  readonly t: number;
  // How far above the block's requirement it stands there (negative: into it).
  readonly h: number;
  // The block's highest requirement anywhere along the move.
  readonly highest: number;
};

// Golden-section and bisection steps: a bracket shrinks below 1e-13 of the move.
const SEARCH_STEPS = 64;
const INVERSE_PHI = (Math.sqrt(5) - 1) / 2;

/** The move against one block, or null when the block is out of its reach. */
export function blockExcess(move: Move, block: Rectangle, law: BlockLaw): BlockExcess | null {
  const nearest = lowestOf((t) => distanceAt(move, block, t), 0, 1);
  const nearestMm = distanceAt(move, block, nearest);
  if (nearestMm > law.reachMm) return null;
  const highest = requirement(law, nearestMm);
  // The lower end already clears the block's highest requirement.
  const lowestZ = Math.min(move.z, move.z + move.dz);
  if (lowestZ >= highest) return { t: nearest, h: lowestZ - highest, highest };
  const start = edgeOfReach(move, block, law, nearest, 0);
  const end = edgeOfReach(move, block, law, nearest, 1);
  const along = (t: number): number =>
    move.z + t * move.dz - requirement(law, distanceAt(move, block, t));
  const t = lowestOf(along, start, end);
  return { t, h: along(t), highest };
}

// The last point in reach from `inside` towards `toward` (0 or 1).
function edgeOfReach(
  move: Move,
  block: Rectangle,
  law: BlockLaw,
  inside: number,
  toward: number,
): number {
  if (distanceAt(move, block, toward) <= law.reachMm) return toward;
  let reached = inside;
  let beyond = toward;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (reached + beyond) / 2;
    if (distanceAt(move, block, middle) <= law.reachMm) reached = middle;
    else beyond = middle;
  }
  return reached;
}

// The tip height the block requires of a cutter whose axis stands
// `distanceMm` from it (within reach).
function requirement(law: BlockLaw, distanceMm: number): number {
  const radiusMm = Math.max(0, distanceMm - law.clearanceMm);
  return law.top - law.dz(Math.min(law.radiusMm, radiusMm));
}

function distanceAt(move: Move, block: Rectangle, t: number): number {
  const x = move.x + t * move.dx;
  const y = move.y + t * move.dy;
  return Math.hypot(gap(x, block.x0, block.x1), gap(y, block.y0, block.y1));
}

function gap(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  return value > end ? value - end : 0;
}

// Golden-section search for the lowest point of a convex function on
// [start, end].
function lowestOf(f: (t: number) => number, start: number, end: number): number {
  let low = start;
  let high = end;
  let left = high - INVERSE_PHI * (high - low);
  let right = low + INVERSE_PHI * (high - low);
  let fLeft = f(left);
  let fRight = f(right);
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    if (fLeft <= fRight) {
      high = right;
      right = left;
      fRight = fLeft;
      left = high - INVERSE_PHI * (high - low);
      fLeft = f(left);
    } else {
      low = left;
      left = right;
      fLeft = fRight;
      right = low + INVERSE_PHI * (high - low);
      fRight = f(right);
    }
  }
  const middle = (low + high) / 2;
  // The search may settle at an end it cannot quite reach.
  const candidates = [middle, start, end];
  return candidates.reduce((best, t) => (f(t) < f(best) ? t : best), middle);
}
