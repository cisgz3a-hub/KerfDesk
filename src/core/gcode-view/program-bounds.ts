// The extent the Inspector's Size reports (ADR-255 amendment 2).
//
// A program read from a file starts wherever the machine happens to be, and
// the viewer draws that as 0,0,0. The first move from there is drawn, but its
// start is the viewer's assumption, not part of the program, so a LightBurn scan
// at X 90 to 160 was reported 160 mm wide. G28 goes to a position stored in the
// controller, which the viewer also draws at 0.
//
// An axis counts from the moment the program sets it: an absolute word on it,
// or motion relative to a position already set. Until then its assumed value
// stays out. An axis the program never sets (Z in most laser files) keeps the
// drawn extent, which is then the assumed value alone.

import type { AxisBounds } from './render-model-types';

type Point = { readonly x: number; readonly y: number; readonly z: number };
type Axis = 'X' | 'Y' | 'Z';

/** Which axes the program has set so far. */
export type KnownAxes = { x: boolean; y: boolean; z: boolean };

export type ProgramBoundsTracker = {
  readonly known: KnownAxes;
  /** Adds the axes of `point` that `known` says the program set. */
  readonly include: (point: Point, known?: KnownAxes) => void;
  /** After a move to `target`: axis words set their axis in absolute mode. */
  readonly moveTo: (
    target: Point,
    axisWords: ReadonlyMap<string, number>,
    absolute: boolean,
  ) => void;
  /** After G28: the homed axes are at a position the program does not state. */
  readonly forget: (axes: ReadonlyArray<Axis>) => void;
  /** After a drilling cycle's moves, which started at `from`. */
  readonly cycle: (
    moves: ReadonlyArray<{ readonly to: Point }>,
    from: Point,
    axisWords: ReadonlyMap<string, number>,
    absolute: boolean,
  ) => void;
  /** Per axis the program's own extent, else the drawn one; null when nothing moved. */
  readonly result: (drawn: AxisBounds | null) => AxisBounds | null;
};

/** Axes known after a move with these words, starting from `known`. */
function axesSetBy(
  known: KnownAxes,
  axisWords: ReadonlyMap<string, number>,
  absolute: boolean,
): KnownAxes {
  const set = (axis: Axis, current: boolean): boolean =>
    axisWords.has(axis) ? absolute || current : current;
  return { x: set('X', known.x), y: set('Y', known.y), z: set('Z', known.z) };
}

export function createProgramBoundsTracker(initialPosition?: Point): ProgramBoundsTracker {
  const startKnown = initialPosition !== undefined;
  const known: KnownAxes = { x: startKnown, y: startKnown, z: startKnown };
  const x = createRange();
  const y = createRange();
  const z = createRange();
  const include = (point: Point, axes: KnownAxes = known): void => {
    if (axes.x) x.add(point.x);
    if (axes.y) y.add(point.y);
    if (axes.z) z.add(point.z);
  };
  if (initialPosition !== undefined) include(initialPosition);
  return {
    known,
    include,
    moveTo: (target, axisWords, absolute) => {
      Object.assign(known, axesSetBy(known, axisWords, absolute));
      include(target);
    },
    forget: (axes) => {
      const all = axes.length === 0;
      if (all || axes.includes('X')) known.x = false;
      if (all || axes.includes('Y')) known.y = false;
      if (all || axes.includes('Z')) known.z = false;
    },
    // A cycle's hole takes its X and Y words, and its R plane and depth count
    // in absolute mode. Before it reaches the hole it may rise at the old X and Y.
    cycle: (moves, from, axisWords, absolute) => {
      const z = known.z || absolute;
      const rising = { ...known, z };
      const after = { ...axesSetBy(known, axisWords, absolute), z };
      for (const { to } of moves) include(to, to.x === from.x && to.y === from.y ? rising : after);
      Object.assign(known, after);
      const last = moves[moves.length - 1];
      if (last !== undefined) include(last.to);
    },
    result: (drawn) => {
      if (drawn === null) return null;
      const [minX, maxX] = x.or(drawn.minX, drawn.maxX);
      const [minY, maxY] = y.or(drawn.minY, drawn.maxY);
      const [minZ, maxZ] = z.or(drawn.minZ, drawn.maxZ);
      return { minX, maxX, minY, maxY, minZ, maxZ };
    },
  };
}

function createRange(): {
  readonly add: (value: number) => void;
  readonly or: (min: number, max: number) => readonly [number, number];
} {
  let min = Infinity;
  let max = -Infinity;
  return {
    add: (value) => {
      if (!Number.isFinite(value)) return;
      min = Math.min(min, value);
      max = Math.max(max, value);
    },
    or: (fallbackMin, fallbackMax) => (min <= max ? [min, max] : [fallbackMin, fallbackMax]),
  };
}
