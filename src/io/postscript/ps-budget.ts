// What one PostScript import may cost (ADR-700 Amendments 2 and 3). Work is
// counted in steps: one per executed object or procedure call, and the size of
// anything an operator walks, copies or builds. Painted and copied path points
// have caps of their own, and the run has a wall-clock limit. Each limit ends
// the run with its own message.

import { PsError, type PsDict, type PsValue, type Subpath } from './ps-types';

export const PS_LIMITS = {
  steps: 20_000_000,
  operands: 100_000,
  callDepth: 256,
  /** Points a file may create. */
  pathPoints: 2_000_000,
  /** Points a file may paint: a path filled and then stroked counts twice. */
  paintedPoints: 4_000_000,
  /** Points a file may copy by saving the graphics state. */
  copiedPoints: 8_000_000,
  /** Entries in one dictionary, as arrays and strings are capped. */
  dictEntries: 100_000,
  /** Wall-clock limit when the reader runs on the window thread. */
  milliseconds: 5_000,
  /** Wall-clock limit in the import worker, where only the worker waits. */
  workerMilliseconds: 30_000,
} as const;

/** Work between two looks at the clock. */
const CLOCK_INTERVAL = 4096;

/** Large but finite files reach this too, so it names both causes (E1-P3-3). */
export const PS_STEP_MESSAGE =
  'The file needs more work than KerfDesk allows: it is too large to import, or it never finishes.';

export function psTimeMessage(milliseconds: number): string {
  return `The file took longer than ${Math.round(milliseconds / 1000)} s to read; it may be too large for this computer.`;
}

/** Points in a path: each subpath's start, one per line, three per curve. */
export function pathPointCount(path: readonly Subpath[]): number {
  let count = 0;
  for (const subpath of path) {
    count += 1;
    for (const segment of subpath.segments) count += segment.kind === 'line' ? 1 : 3;
  }
  return count;
}

export class PsBudget {
  private steps = 0;
  private sinceClock = 0;
  private painted = 0;
  private copied = 0;
  private readonly startedAt: number;

  constructor(
    private readonly clock: () => number,
    private readonly milliseconds: number,
  ) {
    this.startedAt = clock();
  }

  /** Counts work: one step per object, or the size of what an operator walks. */
  charge(cost: number): void {
    this.steps += cost;
    if (this.steps > PS_LIMITS.steps) throw new PsError('budget', PS_STEP_MESSAGE);
    this.sinceClock += cost;
    if (this.sinceClock < CLOCK_INTERVAL) return;
    this.sinceClock = 0;
    if (this.clock() - this.startedAt > this.milliseconds)
      throw new PsError('budget', psTimeMessage(this.milliseconds));
  }

  paint(points: number): void {
    this.charge(points);
    this.painted += points;
    if (this.painted > PS_LIMITS.paintedPoints)
      throw new PsError('budget', 'The file draws more than KerfDesk can import.');
  }

  copy(points: number): void {
    this.charge(points);
    this.copied += points;
    if (this.copied > PS_LIMITS.copiedPoints)
      throw new PsError('budget', 'The file copies its paths more than KerfDesk allows.');
  }
}

/** Writes a dictionary entry, refusing a new key past the entry cap. */
export function setEntry(dict: PsDict, key: string, value: PsValue): void {
  if (!dict.map.has(key) && dict.map.size >= PS_LIMITS.dictEntries)
    throw new PsError('limitcheck', 'A dictionary is too large.');
  dict.map.set(key, value);
}

/** Elements in an array, characters in a string or entries in a dictionary. */
export function compositeSize(value: PsValue): number {
  if (typeof value !== 'object' || value === null) return 0;
  if (value.kind === 'array') return value.items.length;
  if (value.kind === 'string') return value.value.length;
  if (value.kind === 'dict') return value.map.size;
  return 0;
}
