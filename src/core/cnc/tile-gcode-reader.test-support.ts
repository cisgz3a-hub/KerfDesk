// A small, independent G-code reader for the tiling regressions (N4): modal
// G0/G1/G2/G3, X/Y/Z/F words and the emitter's `; cnc layer-id:` comments.
// It shares no code with the planner or the emitter, so the tests judge the
// written tile programs, not the planner's own view of them.

export type Xyz = { readonly x: number; readonly y: number; readonly z: number };

export type Move = {
  readonly motion: 'G0' | 'G1' | 'G2' | 'G3';
  readonly from: Xyz;
  readonly to: Xyz;
  readonly feed: number | null;
  readonly layerId: string | null;
};

const XY_TOLERANCE_MM = 0.002;

export function readProgram(gcode: string, origin = { x: 0, y: 0 }): ReadonlyArray<Move> {
  const moves: Move[] = [];
  let position: Xyz = { x: origin.x, y: origin.y, z: 0 };
  let motion: Move['motion'] = 'G0';
  let feed: number | null = null;
  let layerId: string | null = null;
  for (const raw of gcode.split(/\r?\n/)) {
    const layer = /^;\s*cnc layer-id:\s*(\S+)/.exec(raw);
    if (layer !== null) layerId = layer[1] ?? null;
    const { words, motion: nextMotion } = parseLine(raw);
    motion = nextMotion ?? motion;
    feed = words.get('F') ?? feed;
    if (!words.has('X') && !words.has('Y') && !words.has('Z')) continue;
    const to = nextPosition(words, position, origin);
    moves.push({ motion, from: position, to, feed, layerId });
    position = to;
  }
  return moves;
}

function nextPosition(
  words: ReadonlyMap<string, number>,
  position: Xyz,
  origin: { readonly x: number; readonly y: number },
): Xyz {
  const x = words.get('X');
  const y = words.get('Y');
  return {
    x: x === undefined ? position.x : x + origin.x,
    y: y === undefined ? position.y : y + origin.y,
    z: words.get('Z') ?? position.z,
  };
}

function parseLine(raw: string): {
  readonly words: ReadonlyMap<string, number>;
  readonly motion: Move['motion'] | null;
} {
  const line = raw
    .replace(/;.*$/, '')
    .replace(/\([^)]*\)/g, '')
    .toUpperCase();
  const words = new Map<string, number>();
  let motion: Move['motion'] | null = null;
  for (const match of line.matchAll(/([GXYZFIJ])(-?\d+(?:\.\d+)?)/g)) {
    const letter = match[1] as string;
    const value = Number(match[2]);
    if (letter !== 'G') words.set(letter, value);
    else if ([0, 1, 2, 3].includes(value)) motion = `G${value}` as Move['motion'];
  }
  return { words, motion };
}

export function isVertical(move: Move): boolean {
  return (
    Math.abs(move.to.x - move.from.x) < XY_TOLERANCE_MM &&
    Math.abs(move.to.y - move.from.y) < XY_TOLERANCE_MM
  );
}

/**
 * Straight plunges whose bit centre lands deeper than anything this program
 * has already cut there (or below the stock top where nothing was cut): the
 * bit drills into uncut stock. Cut XY moves count as cut at their lower end.
 */
export function plungesIntoStock(moves: ReadonlyArray<Move>, layerId: string): ReadonlyArray<Xyz> {
  const cut: Array<{ readonly a: Xyz; readonly b: Xyz; readonly z: number }> = [];
  const found: Xyz[] = [];
  for (const move of moves) {
    if (move.motion === 'G0') continue;
    if (move.motion === 'G1' && isVertical(move)) {
      if (move.to.z < move.from.z && move.to.z < 0 && move.layerId === layerId) {
        const floor = cutFloorAt(cut, move.to);
        if (floor === null || move.to.z < floor - 1e-6) found.push(move.to);
      }
      if (move.to.z < 0) cut.push({ a: move.to, b: move.to, z: move.to.z });
      continue;
    }
    cut.push({ a: move.from, b: move.to, z: Math.min(move.from.z, move.to.z) });
  }
  return found;
}

function cutFloorAt(
  cut: ReadonlyArray<{ readonly a: Xyz; readonly b: Xyz; readonly z: number }>,
  point: Xyz,
): number | null {
  let floor: number | null = null;
  for (const segment of cut) {
    if (distanceToSegment(point, segment.a, segment.b) > XY_TOLERANCE_MM) continue;
    floor = floor === null ? segment.z : Math.min(floor, segment.z);
  }
  return floor;
}

export function distanceToSegment(
  p: { readonly x: number; readonly y: number },
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/** Distance from a point to an axis-aligned rectangle's outline. */
export function distanceToRectOutline(
  p: { readonly x: number; readonly y: number },
  rect: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  },
): number {
  const corners = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  return Math.min(
    ...corners.map((corner, index) =>
      distanceToSegment(p, corner, corners[(index + 1) % corners.length] as typeof corner),
    ),
  );
}
