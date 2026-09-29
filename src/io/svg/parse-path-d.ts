// parsePathD — turns an SVG `d` attribute into a list of subpaths
// (polylines in object-local coordinates). Full SVG 1.1 path-data grammar
// support: M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z (each in both
// absolute and relative forms). Curves and arcs are flattened to polylines
// via De Casteljau subdivision (cubic + quadratic) and W3C arc-to-cubic
// conversion. Default flatness 0.25 mm — see flatten-curves.ts. The data is
// read by path-data-tokens.ts, which stops at the first error (SVG 2).

import type { CurveSubpath, PathSegment, Vec2 } from '../../core/scene';
import { DEFAULT_FLATNESS_MM } from './flatten-curves';
import {
  coordinateLimitUserUnits,
  flattenArcWithin,
  flattenCubicWithin,
  flattenQuadraticWithin,
  type FlattenBounds,
} from './flatten-within-limit';
import { tokenizePathData, type PathToken } from './path-data-tokens';
import { closureToleranceUserUnits, endsMeet } from './subpath-closure';

export type SubPath = {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  readonly curve?: CurveSubpath;
};

type MutableSubPath = {
  points: Vec2[];
  closed: boolean;
  start: Vec2;
  segments: PathSegment[];
};

type State = {
  subpaths: MutableSubPath[];
  cur: MutableSubPath | null;
  // SVG 1.1 §8.3.2: ONLY the path's first moveto treats relative coordinates
  // as absolute. `cur === null` is the wrong proxy for "first" — closepath
  // also nulls it, which turned every post-Z relative moveto absolute and
  // displaced later contours (SVGO `z m` output).
  sawCommand: boolean;
  cursor: Vec2;
  // Last cubic control point (for S/s reflection). Reset when the previous
  // command isn't C/c or S/s.
  lastCubicCtrl: Vec2 | null;
  // Last quadratic control point (for T/t reflection). Reset when the previous
  // command isn't Q/q or T/t.
  lastQuadraticCtrl: Vec2 | null;
  bounds: FlattenBounds;
  pointCount: number;
};

// `flatness` is in the caller's user units. `scale` is the element's largest
// user-to-mm stretch, which puts the millimetre closure tolerance (E-2) and
// the importer's coordinate limit (A-07) into user units. Like the flatness,
// it defaults to one user unit per millimetre.
export function parsePathD(
  d: string,
  flatness: number = DEFAULT_FLATNESS_MM,
  scale = 1,
): ReadonlyArray<SubPath> {
  const tokens = tokenizePathData(d);
  const state: State = {
    subpaths: [],
    cur: null,
    sawCommand: false,
    cursor: { x: 0, y: 0 },
    lastCubicCtrl: null,
    lastQuadraticCtrl: null,
    bounds: { flatness, limit: coordinateLimitUserUnits(scale) },
    pointCount: 0,
  };
  for (const tok of tokens) dispatch(state, tok);
  const closureTolerance = closureToleranceUserUnits(scale);
  return state.subpaths.map((sp) => {
    closeIfEndsMeet(sp, closureTolerance);
    return {
      points: sp.points,
      closed: sp.closed,
      curve: { start: sp.start, segments: sp.segments, closed: sp.closed },
    };
  });
}

// A subpath that returns to its start without Z (ended by M or the end of the
// data) is stored exactly as Z would have closed it (E-2): its end lands on
// the start, with no duplicate closing point, and both channels are closed.
// The last point is always the last segment's end, so the two move together.
function closeIfEndsMeet(sub: MutableSubPath, tolerance: number): void {
  if (sub.closed || !endsMeet(sub.points, tolerance)) return;
  sub.points[sub.points.length - 1] = sub.start;
  const last = sub.segments.at(-1);
  if (last !== undefined) sub.segments[sub.segments.length - 1] = { ...last, to: sub.start };
  sub.closed = true;
}

type Handler = (state: State, args: ReadonlyArray<number>, cmd: string) => void;

// Static dispatch table — keeps `dispatch` at complexity 1 and is faster than
// a 20-arm switch.
const HANDLERS: Readonly<Record<string, Handler>> = {
  M: (s, a) => handleMove(s, a, false),
  m: (s, a) => handleMove(s, a, true),
  L: (s, a) => handleLine(s, a, false),
  l: (s, a) => handleLine(s, a, true),
  H: (s, a) => handleHorizontal(s, a, false),
  h: (s, a) => handleHorizontal(s, a, true),
  V: (s, a) => handleVertical(s, a, false),
  v: (s, a) => handleVertical(s, a, true),
  C: (s, a) => handleCubic(s, a, false),
  c: (s, a) => handleCubic(s, a, true),
  S: (s, a) => handleSmoothCubic(s, a, false),
  s: (s, a) => handleSmoothCubic(s, a, true),
  Q: (s, a) => handleQuadratic(s, a, false),
  q: (s, a) => handleQuadratic(s, a, true),
  T: (s, a) => handleSmoothQuadratic(s, a, false),
  t: (s, a) => handleSmoothQuadratic(s, a, true),
  A: (s, a) => handleArc(s, a, false),
  a: (s, a) => handleArc(s, a, true),
  Z: (s) => handleClose(s),
  z: (s) => handleClose(s),
};

function dispatch(state: State, tok: PathToken): void {
  HANDLERS[tok.cmd]?.(state, tok.args, tok.cmd);
  state.sawCommand = true;
}

function ensureSub(state: State): MutableSubPath {
  if (state.cur !== null) return state.cur;
  const sub = createSubpath(state, state.cursor);
  state.cur = sub;
  state.subpaths.push(sub);
  return sub;
}

function startSubpath(state: State, at: Vec2): void {
  const sub = createSubpath(state, at);
  state.cur = sub;
  state.subpaths.push(sub);
}

function createSubpath(state: State, at: Vec2): MutableSubPath {
  reservePathPoints(state, 1);
  return { points: [at], closed: false, start: at, segments: [] };
}

function appendPoint(state: State, sub: MutableSubPath, point: Vec2): void {
  reservePathPoints(state, 1);
  sub.points.push(point);
  sub.segments.push({ kind: 'line', to: point });
}

// A loop, not a spread push: a spread passes every point as an argument and
// overflows the call stack on a very long flattening (A-07).
function appendPoints(state: State, sub: MutableSubPath, points: ReadonlyArray<Vec2>): void {
  reservePathPoints(state, points.length);
  for (const point of points) sub.points.push(point);
}

// The point ceiling was a policy cap and no longer refuses (rule 7 / ADR-268);
// the count is kept because parse state carries it and the import advisory
// reports it. This loop is bounded by the `d` attribute either way.
function reservePathPoints(state: State, count: number): void {
  state.pointCount += count;
}

// Reflects `point` through `pivot`. Used to derive S/s and T/t control points.
function reflect(pivot: Vec2, point: Vec2): Vec2 {
  return { x: 2 * pivot.x - point.x, y: 2 * pivot.y - point.y };
}

function resetSmoothControls(state: State): void {
  state.lastCubicCtrl = null;
  state.lastQuadraticCtrl = null;
}

function handleMove(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 1 < args.length; k += 2) {
    const useRel = rel && (k > 0 || state.sawCommand);
    const x = (args[k] ?? 0) + (useRel ? state.cursor.x : 0);
    const y = (args[k + 1] ?? 0) + (useRel ? state.cursor.y : 0);
    state.cursor = { x, y };
    if (k === 0) startSubpath(state, state.cursor);
    else appendPoint(state, ensureSub(state), state.cursor);
  }
  resetSmoothControls(state);
}

// Each line handler opens its subpath BEFORE moving the cursor: after Z the new
// subpath starts at the closed subpath's start (SVG 2 closepath rule), so a
// line drawn straight after Z runs from there instead of collapsing onto its
// own end point.
function handleLine(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 1 < args.length; k += 2) {
    const sub = ensureSub(state);
    const x = (args[k] ?? 0) + (rel ? state.cursor.x : 0);
    const y = (args[k + 1] ?? 0) + (rel ? state.cursor.y : 0);
    state.cursor = { x, y };
    appendPoint(state, sub, state.cursor);
  }
  resetSmoothControls(state);
}

function handleHorizontal(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (const arg of args) {
    const sub = ensureSub(state);
    const x = arg + (rel ? state.cursor.x : 0);
    state.cursor = { x, y: state.cursor.y };
    appendPoint(state, sub, state.cursor);
  }
  resetSmoothControls(state);
}

function handleVertical(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (const arg of args) {
    const sub = ensureSub(state);
    const y = arg + (rel ? state.cursor.y : 0);
    state.cursor = { x: state.cursor.x, y };
    appendPoint(state, sub, state.cursor);
  }
  resetSmoothControls(state);
}

function offset(x: number, y: number, rel: boolean, cursor: Vec2): Vec2 {
  return { x: x + (rel ? cursor.x : 0), y: y + (rel ? cursor.y : 0) };
}

function handleCubic(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 6 <= args.length; k += 6) {
    const c1 = offset(args[k] ?? 0, args[k + 1] ?? 0, rel, state.cursor);
    const c2 = offset(args[k + 2] ?? 0, args[k + 3] ?? 0, rel, state.cursor);
    const end = offset(args[k + 4] ?? 0, args[k + 5] ?? 0, rel, state.cursor);
    const out: Vec2[] = [];
    flattenCubicWithin(state.cursor, c1, c2, end, state.bounds, out);
    const sub = ensureSub(state);
    appendPoints(state, sub, out);
    sub.segments.push({ kind: 'cubic', control1: c1, control2: c2, to: end });
    state.cursor = end;
    state.lastCubicCtrl = c2;
    state.lastQuadraticCtrl = null;
  }
}

function handleSmoothCubic(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 4 <= args.length; k += 4) {
    const c1 =
      state.lastCubicCtrl === null ? state.cursor : reflect(state.cursor, state.lastCubicCtrl);
    const c2 = offset(args[k] ?? 0, args[k + 1] ?? 0, rel, state.cursor);
    const end = offset(args[k + 2] ?? 0, args[k + 3] ?? 0, rel, state.cursor);
    const out: Vec2[] = [];
    flattenCubicWithin(state.cursor, c1, c2, end, state.bounds, out);
    const sub = ensureSub(state);
    appendPoints(state, sub, out);
    sub.segments.push({ kind: 'cubic', control1: c1, control2: c2, to: end });
    state.cursor = end;
    state.lastCubicCtrl = c2;
    state.lastQuadraticCtrl = null;
  }
}

function handleQuadratic(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 4 <= args.length; k += 4) {
    const c1 = offset(args[k] ?? 0, args[k + 1] ?? 0, rel, state.cursor);
    const end = offset(args[k + 2] ?? 0, args[k + 3] ?? 0, rel, state.cursor);
    const out: Vec2[] = [];
    flattenQuadraticWithin(state.cursor, c1, end, state.bounds, out);
    const sub = ensureSub(state);
    appendPoints(state, sub, out);
    sub.segments.push(quadraticAsCubic(state.cursor, c1, end));
    state.cursor = end;
    state.lastQuadraticCtrl = c1;
    state.lastCubicCtrl = null;
  }
}

function handleSmoothQuadratic(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 2 <= args.length; k += 2) {
    const c1 =
      state.lastQuadraticCtrl === null
        ? state.cursor
        : reflect(state.cursor, state.lastQuadraticCtrl);
    const end = offset(args[k] ?? 0, args[k + 1] ?? 0, rel, state.cursor);
    const out: Vec2[] = [];
    flattenQuadraticWithin(state.cursor, c1, end, state.bounds, out);
    const sub = ensureSub(state);
    appendPoints(state, sub, out);
    sub.segments.push(quadraticAsCubic(state.cursor, c1, end));
    state.cursor = end;
    state.lastQuadraticCtrl = c1;
    state.lastCubicCtrl = null;
  }
}

// SVG path args are dense numeric tuples; with noUncheckedIndexedAccess a
// missing slot means a malformed command, so a defaulted 0 mirrors the prior
// per-read `?? 0`. Extracted so handleArc stays under the complexity cap.
function argAt(args: ReadonlyArray<number>, index: number): number {
  return args[index] ?? 0;
}

function handleArc(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 7 <= args.length; k += 7) {
    const rx = argAt(args, k);
    const ry = argAt(args, k + 1);
    const xAxisRotationDeg = argAt(args, k + 2);
    const largeArc = argAt(args, k + 3) !== 0;
    const sweep = argAt(args, k + 4) !== 0;
    const end = offset(argAt(args, k + 5), argAt(args, k + 6), rel, state.cursor);
    // SVG 1.1 §F.6.2: identical endpoints mean the arc is omitted entirely —
    // no motion, no segment. Skipping here also keeps the degenerate tuple out
    // of the curve channel (it previously survived only by NaN accident).
    if (isSamePoint(end, state.cursor)) continue;
    const out: Vec2[] = [];
    flattenArcWithin(
      state.cursor,
      end,
      { rx, ry, xAxisRotationDeg, largeArc, sweep },
      state.bounds,
      out,
    );
    const sub = ensureSub(state);
    appendPoints(state, sub, out);
    sub.segments.push(
      rx === 0 || ry === 0
        ? { kind: 'line', to: end }
        : {
            kind: 'elliptical-arc',
            radiusX: Math.abs(rx),
            radiusY: Math.abs(ry),
            rotationDeg: xAxisRotationDeg,
            largeArc,
            sweep,
            to: end,
          },
    );
    state.cursor = end;
  }
  resetSmoothControls(state);
}

function isSamePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function quadraticAsCubic(from: Vec2, control: Vec2, to: Vec2): PathSegment {
  return {
    kind: 'cubic',
    control1: {
      x: from.x + (2 / 3) * (control.x - from.x),
      y: from.y + (2 / 3) * (control.y - from.y),
    },
    control2: {
      x: to.x + (2 / 3) * (control.x - to.x),
      y: to.y + (2 / 3) * (control.y - to.y),
    },
    to,
  };
}

function handleClose(state: State): void {
  const sub = state.cur;
  if (sub === null) return;
  appendPoint(state, sub, sub.start);
  sub.closed = true;
  state.cursor = sub.start;
  state.cur = null;
  resetSmoothControls(state);
}
