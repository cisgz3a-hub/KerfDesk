// The route a Toolpath carries, as a list that need not be an array.
//
// A scanline fill over a dense trace compiles to millions of steps, and as
// plain objects each one costs about 217 bytes measured live: the step, its
// nested points, and a polyline array for every two-point span. A route built
// over typed arrays costs a fraction of that, but only if nothing materializes
// the whole list to read it.
//
// ReadonlyArray<ToolpathStep> satisfies this interface as it stands, so every
// caller that builds a route from an array keeps working. What it deliberately
// does NOT carry is the numeric index signature: `steps[i]` no longer compiles,
// and each site becomes `steps.at(i)` — an accessor a packed route can answer
// without holding an object per step. The methods listed here are the ones
// routes are actually read with; each is O(n) in time but allocates only what
// it returns, and a packed implementation materializes one step at a time.

import type { ToolpathStep } from './toolpath-types';

export interface ToolpathStepList extends Iterable<ToolpathStep> {
  readonly length: number;
  at(index: number): ToolpathStep | undefined;
  map<T>(callback: (step: ToolpathStep, index: number) => T): T[];
  flatMap<T>(callback: (step: ToolpathStep, index: number) => T | ReadonlyArray<T>): T[];
  forEach(callback: (step: ToolpathStep, index: number) => void): void;
  // Both overloads mirror Array's so an inferred type predicate (`step.kind
  // === 'cut'`) still narrows the result, as it does on a plain route.
  filter<S extends ToolpathStep>(predicate: (step: ToolpathStep, index: number) => step is S): S[];
  filter(predicate: (step: ToolpathStep, index: number) => boolean): ToolpathStep[];
  find<S extends ToolpathStep>(
    predicate: (step: ToolpathStep, index: number) => step is S,
  ): S | undefined;
  find(predicate: (step: ToolpathStep, index: number) => boolean): ToolpathStep | undefined;
  findIndex(predicate: (step: ToolpathStep, index: number) => boolean): number;
  some(predicate: (step: ToolpathStep, index: number) => boolean): boolean;
  every(predicate: (step: ToolpathStep, index: number) => boolean): boolean;
  reduce<T>(callback: (accumulator: T, step: ToolpathStep, index: number) => T, initial: T): T;
  slice(start?: number, end?: number): ToolpathStep[];
  entries(): IterableIterator<[number, ToolpathStep]>;
}

/** Materialize a route as a plain array. O(n) memory: only for bounded routes. */
export function toolpathStepArray(steps: ToolpathStepList): ToolpathStep[] {
  return Array.isArray(steps) ? (steps as ToolpathStep[]) : [...steps];
}
