// The interpreter core: operand and dictionary stacks, execution, graphics
// state and the current path. Operators live in the ps-ops-* tables.
// Every executed object costs one step and every path point counts toward a
// cap, so a hostile or runaway file ends in a clear error, never a hang.

import { apply, applyDelta, IDENTITY, invert, linearScale } from './ps-matrix';
import type { PsTokenizer } from './ps-tokenizer';
import {
  PsError,
  psDict,
  type Matrix,
  type PaintedPath,
  type PsArray,
  type PsDict,
  type PsString,
  type PsValue,
  type Subpath,
  type Vec,
} from './ps-types';

export const PS_LIMITS = {
  steps: 20_000_000,
  operands: 100_000,
  callDepth: 256,
  pathPoints: 2_000_000,
} as const;

export type ColorSpace =
  | { readonly kind: 'gray' | 'rgb' | 'cmyk' }
  | { readonly kind: 'separation'; readonly tint: PsArray; readonly alt: 'gray' | 'rgb' | 'cmyk' };

export type GState = {
  ctm: Matrix;
  fill: string;
  stroke: string;
  lineWidth: number;
  path: Subpath[];
  current: Vec | null;
  space: ColorSpace;
};

/** `exit` leaves the innermost loop. */
export class ExitSignal {
  readonly signal = 'exit';
}
/** `stop` returns to the innermost `stopped`. */
export class StopSignal {
  readonly signal = 'stop';
}
/** `showpage` or `quit` ends the drawing. */
export class HaltSignal {
  readonly signal = 'halt';
}

export class PsVm {
  readonly operands: PsValue[] = [];
  readonly systemdict: PsDict = psDict();
  readonly globaldict: PsDict = psDict();
  readonly userdict: PsDict = psDict();
  readonly dicts: PsDict[] = [this.systemdict, this.globaldict, this.userdict];
  gstate: GState = newGState();
  readonly gstack: GState[] = [];
  readonly painted: PaintedPath[] = [];
  readonly notes = new Map<string, number>();
  tokenizer: PsTokenizer | null = null;
  /** AI mode: names nobody defined clear the operand stack instead of failing. */
  unknownName: ((name: string) => void) | null = null;
  private steps = 0;
  private depth = 0;
  private points = 0;

  note(code: string, count = 1): void {
    this.notes.set(code, (this.notes.get(code) ?? 0) + count);
  }

  push(value: PsValue): void {
    if (this.operands.length >= PS_LIMITS.operands)
      throw new PsError('budget', 'The file needs more working memory than KerfDesk allows.');
    this.operands.push(value);
  }

  pop(): PsValue {
    if (this.operands.length === 0)
      throw new PsError('stackunderflow', 'An operator ran out of operands.');
    return this.operands.pop() as PsValue;
  }

  popNumber(): number {
    const value = this.pop();
    if (typeof value !== 'number') throw new PsError('typecheck', 'Expected a number.');
    return value;
  }

  popNumbers(count: number): number[] {
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) values.unshift(this.popNumber());
    return values;
  }

  popInteger(): number {
    return Math.trunc(this.popNumber());
  }

  popBool(): boolean {
    const value = this.pop();
    if (typeof value !== 'boolean') throw new PsError('typecheck', 'Expected true or false.');
    return value;
  }

  popArray(): PsArray {
    const value = this.pop();
    if (typeof value !== 'object' || value === null || value.kind !== 'array')
      throw new PsError('typecheck', 'Expected an array or procedure.');
    return value;
  }

  popDict(): PsDict {
    const value = this.pop();
    if (typeof value !== 'object' || value === null || value.kind !== 'dict')
      throw new PsError('typecheck', 'Expected a dictionary.');
    return value;
  }

  popString(): PsString {
    const value = this.pop();
    if (typeof value !== 'object' || value === null || value.kind !== 'string')
      throw new PsError('typecheck', 'Expected a string.');
    return value;
  }

  lookup(name: string): PsValue | undefined {
    for (let i = this.dicts.length - 1; i >= 0; i -= 1) {
      const map = this.dicts[i]?.map;
      if (map?.has(name)) return map.get(name);
    }
    return undefined;
  }

  get currentDict(): PsDict {
    return this.dicts[this.dicts.length - 1] ?? this.userdict;
  }

  run(tokenizer: PsTokenizer): void {
    this.tokenizer = tokenizer;
    try {
      for (let token = tokenizer.next(); token !== undefined; token = tokenizer.next()) {
        if (typeof token === 'object' && token !== null && token.kind === 'name' && !token.literal)
          this.executeName(token.name);
        else this.push(token);
      }
    } catch (error) {
      if (!(error instanceof HaltSignal)) throw error;
    }
  }

  executeName(name: string): void {
    const value = this.lookup(name);
    if (value !== undefined) {
      this.execute(value);
      return;
    }
    if (this.unknownName !== null) {
      this.unknownName(name);
      return;
    }
    throw new PsError('undefined', `The file uses "${name}", which KerfDesk cannot read.`);
  }

  /** Execute an object as the interpreter would after looking it up. */
  execute(value: PsValue): void {
    this.tick();
    if (typeof value !== 'object' || value === null) {
      this.push(value);
      return;
    }
    if (value.kind === 'operator') value.run(this);
    else if (value.kind === 'array' && value.exec) this.runProcedure(value);
    else if (value.kind === 'name' && !value.literal) this.executeName(value.name);
    else this.push(value);
  }

  runProcedure(procedure: PsArray): void {
    if (this.depth >= PS_LIMITS.callDepth)
      throw new PsError('budget', 'The file calls procedures too deeply.');
    this.depth += 1;
    try {
      for (const item of procedure.items) {
        this.tick();
        if (typeof item !== 'object' || item === null) this.push(item);
        else if (item.kind === 'name' && !item.literal) this.executeName(item.name);
        else if (item.kind === 'operator') item.run(this);
        else this.push(item);
      }
    } finally {
      this.depth -= 1;
    }
  }

  private tick(): void {
    this.steps += 1;
    if (this.steps > PS_LIMITS.steps)
      throw new PsError('budget', 'The file takes too long to draw; it may loop forever.');
  }

  // ---- Path construction, in user space; stored in device space ----

  moveTo(p: Vec): void {
    const device = apply(this.gstate.ctm, p);
    this.countPoint();
    const path = this.gstate.path;
    const last = path[path.length - 1];
    if (last !== undefined && last.segments.length === 0) path.pop();
    path.push({ start: device, segments: [], closed: false });
    this.gstate.current = device;
  }

  lineTo(p: Vec): void {
    const to = apply(this.gstate.ctm, p);
    this.openSubpath().segments.push({ kind: 'line', to });
    this.gstate.current = to;
  }

  curveTo(c1: Vec, c2: Vec, p: Vec): void {
    const m = this.gstate.ctm;
    const to = apply(m, p);
    this.openSubpath().segments.push({ kind: 'cubic', c1: apply(m, c1), c2: apply(m, c2), to });
    this.countPoint(2);
    this.gstate.current = to;
  }

  /** The user-space point a user-space delta away from the current point. */
  relativeUserPoint(delta: Vec): Vec {
    const current = this.requireCurrent();
    const d = applyDelta(this.gstate.ctm, delta);
    return apply(invert(this.gstate.ctm), { x: current.x + d.x, y: current.y + d.y });
  }

  currentUserPoint(): Vec {
    return apply(invert(this.gstate.ctm), this.requireCurrent());
  }

  closePath(): void {
    const last = this.gstate.path[this.gstate.path.length - 1];
    if (last === undefined || last.closed) return;
    last.closed = true;
    this.gstate.current = last.start;
  }

  newPath(): void {
    this.gstate.path = [];
    this.gstate.current = null;
  }

  /** Record the current path as painted, then clear it (fill and stroke do). */
  paint(mode: { fill: boolean; stroke: boolean; evenOdd: boolean }): void {
    const subpaths = this.gstate.path.filter((s) => s.segments.length > 0);
    const g = this.gstate;
    if (subpaths.length > 0)
      this.painted.push({
        subpaths,
        fill: mode.fill ? g.fill : null,
        stroke: mode.stroke ? g.stroke : null,
        strokeWidth: g.lineWidth * linearScale(g.ctm),
        evenOdd: mode.evenOdd,
      });
    this.newPath();
  }

  private openSubpath(): Subpath {
    const path = this.gstate.path;
    const last = path[path.length - 1];
    if (last !== undefined && !last.closed) {
      this.countPoint();
      return last;
    }
    // A segment after closepath starts a new subpath at the closed start.
    const start = this.requireCurrent();
    const fresh: Subpath = { start, segments: [], closed: false };
    path.push(fresh);
    this.countPoint(2);
    return fresh;
  }

  private requireCurrent(): Vec {
    const current = this.gstate.current;
    if (current === null) throw new PsError('nocurrentpoint', 'A path segment has no start point.');
    return current;
  }

  private countPoint(count = 1): void {
    this.points += count;
    if (this.points > PS_LIMITS.pathPoints)
      throw new PsError('budget', 'The drawing has more path points than KerfDesk can import.');
  }
}

export function newGState(): GState {
  return {
    ctm: IDENTITY,
    fill: '#000000',
    stroke: '#000000',
    lineWidth: 1,
    path: [],
    current: null,
    space: { kind: 'gray' },
  };
}

export function copyGState(g: GState): GState {
  return {
    ...g,
    path: g.path.map((s) => ({ ...s, segments: [...s.segments] })),
  };
}
