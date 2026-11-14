// An independent G-code burn reader for tests (tools audit T1, T33 refuter).
// It shares no parser with production code. It sums the lit length of G1, G2
// and G3 moves per "F<feed> S<power>" pair, counting a move only while the
// beam is armed (M3/M4) and S > 0, which is what a GRBL laser burns.

export type LitBurn = {
  readonly total: number;
  /** Lit millimetres per "F<feed> S<power>". */
  readonly byFeedPower: ReadonlyMap<string, number>;
};

type Point = { readonly x: number; readonly y: number };
type Words = { readonly g: number[]; readonly m: number[]; readonly axes: Record<string, number> };
type Machine = {
  at: Point;
  feed: number;
  power: number;
  mode: number;
  armed: boolean;
  absolute: boolean;
};

function words(raw: string): Words | null {
  const line = raw
    .replace(/;.*$/, '')
    .replace(/\([^)]*\)/g, '')
    .toUpperCase()
    .trim();
  if (line === '') return null;
  const parsed: Words = { g: [], m: [], axes: {} };
  for (const match of line.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+(?:E[-+]?\d+)?)/g)) {
    const letter = match[1] ?? '';
    const value = Number(match[2]);
    if (letter === 'G') parsed.g.push(value);
    else if (letter === 'M') parsed.m.push(value);
    else parsed.axes[letter] = value;
  }
  return parsed;
}

// Modal words apply before the block's motion.
function applyModes(machine: Machine, parsed: Words): void {
  for (const code of parsed.m) {
    if (code === 3 || code === 4) machine.armed = true;
    if (code === 5) machine.armed = false;
  }
  for (const code of parsed.g) {
    if (code >= 0 && code <= 3) machine.mode = code;
    if (code === 90) machine.absolute = true;
    if (code === 91) machine.absolute = false;
  }
  machine.feed = parsed.axes['F'] ?? machine.feed;
  machine.power = parsed.axes['S'] ?? machine.power;
}

function axisTarget(machine: Machine, word: number | undefined, from: number): number {
  if (word === undefined) return from;
  return machine.absolute ? word : from + word;
}

function arcLength(mode: number, from: Point, to: Point, axes: Record<string, number>): number {
  const cx = from.x + (axes['I'] ?? 0);
  const cy = from.y + (axes['J'] ?? 0);
  const radius = Math.hypot(from.x - cx, from.y - cy);
  const a0 = Math.atan2(from.y - cy, from.x - cx);
  const a1 = Math.atan2(to.y - cy, to.x - cx);
  let sweep = mode === 3 ? a1 - a0 : a0 - a1;
  while (sweep <= 0) sweep += 2 * Math.PI;
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-9) sweep = 2 * Math.PI;
  return radius * sweep;
}

function moveLength(machine: Machine, to: Point, axes: Record<string, number>): number {
  const isArc = machine.mode === 2 || machine.mode === 3;
  if (isArc && (axes['I'] !== undefined || axes['J'] !== undefined))
    return arcLength(machine.mode, machine.at, to, axes);
  return Math.hypot(to.x - machine.at.x, to.y - machine.at.y);
}

export function litBurn(gcode: string): LitBurn {
  const machine: Machine = {
    at: { x: 0, y: 0 },
    feed: 0,
    power: 0,
    mode: 0,
    armed: false,
    absolute: true,
  };
  let total = 0;
  const byFeedPower = new Map<string, number>();
  for (const raw of gcode.split(/\r?\n/)) {
    const parsed = words(raw);
    if (parsed === null) continue;
    applyModes(machine, parsed);
    const { axes } = parsed;
    if (axes['X'] === undefined && axes['Y'] === undefined) continue;
    const to = {
      x: axisTarget(machine, axes['X'], machine.at.x),
      y: axisTarget(machine, axes['Y'], machine.at.y),
    };
    const length = moveLength(machine, to, axes);
    const lit = machine.mode !== 0 && machine.armed && machine.power > 0;
    if (lit && length > 0) {
      const key = `F${machine.feed} S${machine.power}`;
      byFeedPower.set(key, (byFeedPower.get(key) ?? 0) + length);
      total += length;
    }
    machine.at = to;
  }
  return { total, byFeedPower };
}
