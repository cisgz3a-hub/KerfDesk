// board-anchor-placement — where artwork lands for each of the nine placement
// anchors on a placed board (ADR-636): the four corners, the four edge middles
// and the centre, each a chosen clearance in from the board's edge.
//
// A rectangle reads exactly like a 3x3 alignment grid. A round or custom-shape
// board has no corners to align a box to, so the artwork starts at the board's
// centre and slides toward the anchor until it meets the edge clearance: Bottom
// middle on a disc sits as low as the curve allows, Top left on a hexagon tucks
// into that slanted corner. Pure — no scene mutation, no I/O.

import type { AABB } from './hit-test';
import type { Vec2 } from './scene-object';
import { boardRegionCenter, boxInsideBoardRegion, type BoardRegion } from './board-region';

export type BoardPlacementAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** Row-major, top row first — the order a 3x3 picker lays them out. */
export const BOARD_PLACEMENT_ANCHORS: ReadonlyArray<BoardPlacementAnchor> = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

export type BoardPlacementPlan = {
  readonly dx: number;
  readonly dy: number;
  /** False when the artwork cannot sit inside the board with that clearance. */
  readonly fits: boolean;
};

type Direction = { readonly x: -1 | 0 | 1; readonly y: -1 | 0 | 1 };

const SLIDE_STEPS = 256;
const BISECTION_ROUNDS = 32;
const SEARCH_GRID = 32;

export function boardPlacementAnchorLabel(anchor: BoardPlacementAnchor): string {
  switch (anchor) {
    case 'top-left':
      return 'Top left';
    case 'top-center':
      return 'Top middle';
    case 'top-right':
      return 'Top right';
    case 'middle-left':
      return 'Middle left';
    case 'center':
      return 'Center';
    case 'middle-right':
      return 'Middle right';
    case 'bottom-left':
      return 'Bottom left';
    case 'bottom-center':
      return 'Bottom middle';
    case 'bottom-right':
      return 'Bottom right';
  }
}

/**
 * The translation that moves `artwork` (its scene-space bounding box) to
 * `anchor` on the board, at least `marginMm` in from the edge. Canvas Y grows
 * downward, so "bottom" is the edge nearest the operator.
 */
export function planBoardPlacement(
  artwork: AABB,
  region: BoardRegion,
  anchor: BoardPlacementAnchor,
  marginMm: number,
): BoardPlacementPlan {
  const margin = Number.isFinite(marginMm) ? Math.max(0, marginMm) : 0;
  const direction = anchorDirection(anchor);
  if (region.kind === 'rect') return boxPlacement(artwork, region.bounds, direction, margin);
  const width = artwork.maxX - artwork.minX;
  const height = artwork.maxY - artwork.minY;
  const fitsAt = (center: Vec2): boolean =>
    boxInsideBoardRegion(region, boxAt(center, width, height), margin);
  const start = startingCenter(region, fitsAt);
  if (start === null) {
    // Larger than the board: align to its bounding box and say it overhangs.
    return { ...boxPlacement(artwork, region.bounds, direction, margin), fits: false };
  }
  const reach = Math.hypot(
    region.bounds.maxX - region.bounds.minX,
    region.bounds.maxY - region.bounds.minY,
  );
  let center = start;
  if (direction.x !== 0 && direction.y !== 0) {
    center = slide(
      center,
      { x: direction.x / Math.SQRT2, y: direction.y / Math.SQRT2 },
      reach,
      fitsAt,
    );
  }
  // Settle into the corner along each axis in turn (twice, so a slanted edge
  // reached first along X can still give way along Y).
  for (let round = 0; round < 2; round += 1) {
    if (direction.x !== 0) center = slide(center, { x: direction.x, y: 0 }, reach, fitsAt);
    if (direction.y !== 0) center = slide(center, { x: 0, y: direction.y }, reach, fitsAt);
  }
  return {
    dx: center.x - (artwork.minX + artwork.maxX) / 2,
    dy: center.y - (artwork.minY + artwork.maxY) / 2,
    fits: true,
  };
}

function anchorDirection(anchor: BoardPlacementAnchor): Direction {
  const [row, column] = anchor === 'center' ? ['middle', 'center'] : anchor.split('-');
  return {
    x: column === 'left' ? -1 : column === 'right' ? 1 : 0,
    y: row === 'top' ? -1 : row === 'bottom' ? 1 : 0,
  };
}

// The classic grid alignment against a box inset by the margin.
function boxPlacement(
  artwork: AABB,
  bounds: AABB,
  direction: Direction,
  margin: number,
): BoardPlacementPlan {
  const inner = {
    minX: bounds.minX + margin,
    maxX: bounds.maxX - margin,
    minY: bounds.minY + margin,
    maxY: bounds.maxY - margin,
  };
  const dx = axisDelta(artwork.minX, artwork.maxX, inner.minX, inner.maxX, direction.x);
  const dy = axisDelta(artwork.minY, artwork.maxY, inner.minY, inner.maxY, direction.y);
  const epsilon = 1e-6;
  const fits =
    artwork.maxX - artwork.minX <= inner.maxX - inner.minX + epsilon &&
    artwork.maxY - artwork.minY <= inner.maxY - inner.minY + epsilon;
  return { dx, dy, fits };
}

function axisDelta(min: number, max: number, lo: number, hi: number, side: -1 | 0 | 1): number {
  if (side === -1) return lo - min;
  if (side === 1) return hi - max;
  return (lo + hi) / 2 - (min + max) / 2;
}

function startingCenter(region: BoardRegion, fitsAt: (center: Vec2) => boolean): Vec2 | null {
  const preferred = boardRegionCenter(region);
  if (fitsAt(preferred)) return preferred;
  // A wide design on a narrow-waisted board may fit only off-centre: take the
  // fitting grid point nearest the preferred centre.
  const { bounds } = region;
  let best: Vec2 | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= SEARCH_GRID; i += 1) {
    for (let j = 0; j <= SEARCH_GRID; j += 1) {
      const candidate = {
        x: bounds.minX + ((bounds.maxX - bounds.minX) * i) / SEARCH_GRID,
        y: bounds.minY + ((bounds.maxY - bounds.minY) * j) / SEARCH_GRID,
      };
      const distance = Math.hypot(candidate.x - preferred.x, candidate.y - preferred.y);
      if (distance < bestDistance && fitsAt(candidate)) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

// Move from a fitting centre along `direction` as far as the artwork keeps
// fitting, stopping at the first obstruction (so it never jumps a notch).
function slide(
  from: Vec2,
  direction: Vec2,
  reach: number,
  fitsAt: (center: Vec2) => boolean,
): Vec2 {
  const at = (t: number): Vec2 => ({ x: from.x + direction.x * t, y: from.y + direction.y * t });
  const step = reach / SLIDE_STEPS;
  if (!(step > 0)) return from;
  let inside = 0;
  let outside: number | null = null;
  for (let t = step; t <= reach + step / 2; t += step) {
    if (!fitsAt(at(t))) {
      outside = t;
      break;
    }
    inside = t;
  }
  if (outside === null) return at(inside);
  for (let round = 0; round < BISECTION_ROUNDS; round += 1) {
    const middle = (inside + outside) / 2;
    if (fitsAt(at(middle))) inside = middle;
    else outside = middle;
  }
  return at(inside);
}

function boxAt(center: Vec2, width: number, height: number): AABB {
  return {
    minX: center.x - width / 2,
    maxX: center.x + width / 2,
    minY: center.y - height / 2,
    maxY: center.y + height / 2,
  };
}
