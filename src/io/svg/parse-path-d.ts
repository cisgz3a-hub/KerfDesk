// parsePathD — turns an SVG `d` attribute into a list of subpaths
// (polylines in object-local coordinates). Full SVG 1.1 path-data grammar
// support: M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z (each in both
// absolute and relative forms). Curves and arcs are flattened to polylines
// via De Casteljau subdivision (cubic + quadratic) and W3C arc-to-cubic
// conversion. Default flatness 0.25 mm — see flatten-curves.ts.

import type { Vec2 } from '../../core/scene';
import { DEFAULT_FLATNESS_MM, flattenArc, flattenCubic, flattenQuadratic } from './flatten-curves';

export type SubPath = {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

type MutableSubPath = {
  points: Vec2[];
  closed: boolean;
  start: Vec2;
};

type State = {
  subpaths: MutableSubPath[];
  cur: MutableSubPath | null;
  cursor: Vec2;
  // Last cubic control point (for S/s reflection). Reset when the previous
  // command isn't C/c or S/s.
  lastCubicCtrl: Vec2 | null;
  // Last quadratic control point (for T/t reflection). Reset when the previous
  // command isn't Q/q or T/t.
  lastQuadraticCtrl: Vec2 | null;
  flatness: number;
};

type Token = { readonly cmd: string; readonly args: ReadonlyArray<number> };

const COMMAND_LETTERS = new Set([
  'M',
  'm',
  'L',
  'l',
  'H',
  'h',
  'V',
  'v',
  'C',
  'c',
  'S',
  's',
  'Q',
  'q',
  'T',
  't',
  'A',
  'a',
  'Z',
  'z',
]);

const NUMBER_RE = /[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g;

export function parsePathD(
  d: string,
  flatness: number = DEFAULT_FLATNESS_MM,
): ReadonlyArray<SubPath> {
  const tokens = tokenize(d);
  const state: State = {
    subpaths: [],
    cur: null,
    cursor: { x: 0, y: 0 },
    lastCubicCtrl: null,
    lastQuadraticCtrl: null,
    flatness,
  };
  for (const tok of tokens) dispatch(state, tok);
  return state.subpaths.map((sp) => ({ points: sp.points, closed: sp.closed }));
}

function tokenize(d: string): ReadonlyArray<Token> {
  const out: Token[] = [];
  let i = 0;
  while (i < d.length) {
    const ch = d[i];
    if (ch === undefined) break;
    if (COMMAND_LETTERS.has(ch)) {
      let j = i + 1;
      while (j < d.length && !COMMAND_LETTERS.has(d[j] ?? '')) j += 1;
      const slice = d.slice(i + 1, j);
      const args = (slice.match(NUMBER_RE) ?? []).map(Number);
      out.push({ cmd: ch, args });
      i = j;
    } else {
      i += 1;
    }
  }
  return out;
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

function dispatch(state: State, tok: Token): void {
  HANDLERS[tok.cmd]?.(state, tok.args, tok.cmd);
}

function ensureSub(state: State): MutableSubPath {
  if (state.cur !== null) return state.cur;
  const sub: MutableSubPath = {
    points: [state.cursor],
    closed: false,
    start: state.cursor,
  };
  state.cur = sub;
  state.subpaths.push(sub);
  return sub;
}

function startSubpath(state: State, at: Vec2): void {
  const sub: MutableSubPath = { points: [at], closed: false, start: at };
  state.cur = sub;
  state.subpaths.push(sub);
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
    const useRel = rel && (k > 0 || state.cur !== null);
    const x = (args[k] ?? 0) + (useRel ? state.cursor.x : 0);
    const y = (args[k + 1] ?? 0) + (useRel ? state.cursor.y : 0);
    state.cursor = { x, y };
    if (k === 0) startSubpath(state, state.cursor);
    else ensureSub(state).points.push(state.cursor);
  }
  resetSmoothControls(state);
}

function handleLine(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 1 < args.length; k += 2) {
    const x = (args[k] ?? 0) + (rel ? state.cursor.x : 0);
    const y = (args[k + 1] ?? 0) + (rel ? state.cursor.y : 0);
    state.cursor = { x, y };
    ensureSub(state).points.push(state.cursor);
  }
  resetSmoothControls(state);
}

function handleHorizontal(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (const arg of args) {
    const x = arg + (rel ? state.cursor.x : 0);
    state.cursor = { x, y: state.cursor.y };
    ensureSub(state).points.push(state.cursor);
  }
  resetSmoothControls(state);
}

function handleVertical(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (const arg of args) {
    const y = arg + (rel ? state.cursor.y : 0);
    state.cursor = { x: state.cursor.x, y };
    ensureSub(state).points.push(state.cursor);
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
    flattenCubic(state.cursor, c1, c2, end, state.flatness, out);
    ensureSub(state).points.push(...out);
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
    flattenCubic(state.cursor, c1, c2, end, state.flatness, out);
    ensureSub(state).points.push(...out);
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
    flattenQuadratic(state.cursor, c1, end, state.flatness, out);
    ensureSub(state).points.push(...out);
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
    flattenQuadratic(state.cursor, c1, end, state.flatness, out);
    ensureSub(state).points.push(...out);
    state.cursor = end;
    state.lastQuadraticCtrl = c1;
    state.lastCubicCtrl = null;
  }
}

function handleArc(state: State, args: ReadonlyArray<number>, rel: boolean): void {
  for (let k = 0; k + 7 <= args.length; k += 7) {
    const rx = args[k] ?? 0;
    const ry = args[k + 1] ?? 0;
    const xAxisRotationDeg = args[k + 2] ?? 0;
    const largeArc = (args[k + 3] ?? 0) !== 0;
    const sweep = (args[k + 4] ?? 0) !== 0;
    const end = offset(args[k + 5] ?? 0, args[k + 6] ?? 0, rel, state.cursor);
    const out: Vec2[] = [];
    flattenArc(
      state.cursor,
      end,
      { rx, ry, xAxisRotationDeg, largeArc, sweep },
      state.flatness,
      out,
    );
    ensureSub(state).points.push(...out);
    state.cursor = end;
  }
  resetSmoothControls(state);
}

function handleClose(state: State): void {
  const sub = state.cur;
  if (sub === null) return;
  sub.points.push(sub.start);
  sub.closed = true;
  state.cursor = sub.start;
  state.cur = null;
  resetSmoothControls(state);
}
