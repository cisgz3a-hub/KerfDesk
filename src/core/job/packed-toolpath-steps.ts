// A route read straight out of its columnar buffers.
//
// Every method here is the array method of the same name, written over
// `at()` so that exactly one step object exists at a time. The step a caller
// receives is a fresh record built from the buffers, not a retained one: a
// consumer that walks the route allocates only what it keeps, and a route that
// is merely stored costs its buffers and nothing else.
//
// Reading the same index twice returns equal but distinct records, so identity
// comparison between two reads is meaningless — as it already was across the
// worker boundary, where every step arrived as a fresh clone.

import { packToolpath, unpackToolpathStep, type PackedToolpath } from './packed-toolpath';
import type { ToolpathStepList } from './toolpath-steps';
import type { ToolpathStep } from './toolpath-types';

export class PackedToolpathSteps implements ToolpathStepList {
  readonly length: number;

  constructor(readonly packed: PackedToolpath) {
    this.length = packed.stepKinds.length;
  }

  at(index: number): ToolpathStep | undefined {
    const resolved = index < 0 ? this.length + index : index;
    if (!Number.isInteger(resolved) || resolved < 0 || resolved >= this.length) return undefined;
    return unpackToolpathStep(this.packed, resolved);
  }

  *[Symbol.iterator](): Iterator<ToolpathStep> {
    for (let index = 0; index < this.length; index += 1) {
      yield unpackToolpathStep(this.packed, index);
    }
  }

  *entries(): IterableIterator<[number, ToolpathStep]> {
    for (let index = 0; index < this.length; index += 1) {
      yield [index, unpackToolpathStep(this.packed, index)];
    }
  }

  map<T>(callback: (step: ToolpathStep, index: number) => T): T[] {
    const mapped: T[] = new Array<T>(this.length);
    for (let index = 0; index < this.length; index += 1) {
      mapped[index] = callback(unpackToolpathStep(this.packed, index), index);
    }
    return mapped;
  }

  flatMap<T>(callback: (step: ToolpathStep, index: number) => T | ReadonlyArray<T>): T[] {
    const mapped: T[] = [];
    for (let index = 0; index < this.length; index += 1) {
      const value = callback(unpackToolpathStep(this.packed, index), index);
      if (Array.isArray(value)) mapped.push(...(value as ReadonlyArray<T>));
      else mapped.push(value as T);
    }
    return mapped;
  }

  forEach(callback: (step: ToolpathStep, index: number) => void): void {
    for (let index = 0; index < this.length; index += 1) {
      callback(unpackToolpathStep(this.packed, index), index);
    }
  }

  filter<S extends ToolpathStep>(predicate: (step: ToolpathStep, index: number) => step is S): S[];
  filter(predicate: (step: ToolpathStep, index: number) => boolean): ToolpathStep[];
  filter(predicate: (step: ToolpathStep, index: number) => boolean): ToolpathStep[] {
    const kept: ToolpathStep[] = [];
    for (let index = 0; index < this.length; index += 1) {
      const step = unpackToolpathStep(this.packed, index);
      if (predicate(step, index)) kept.push(step);
    }
    return kept;
  }

  find<S extends ToolpathStep>(
    predicate: (step: ToolpathStep, index: number) => step is S,
  ): S | undefined;
  find(predicate: (step: ToolpathStep, index: number) => boolean): ToolpathStep | undefined;
  find(predicate: (step: ToolpathStep, index: number) => boolean): ToolpathStep | undefined {
    for (let index = 0; index < this.length; index += 1) {
      const step = unpackToolpathStep(this.packed, index);
      if (predicate(step, index)) return step;
    }
    return undefined;
  }

  findIndex(predicate: (step: ToolpathStep, index: number) => boolean): number {
    for (let index = 0; index < this.length; index += 1) {
      if (predicate(unpackToolpathStep(this.packed, index), index)) return index;
    }
    return -1;
  }

  some(predicate: (step: ToolpathStep, index: number) => boolean): boolean {
    return this.findIndex(predicate) !== -1;
  }

  every(predicate: (step: ToolpathStep, index: number) => boolean): boolean {
    return this.findIndex((step, index) => !predicate(step, index)) === -1;
  }

  reduce<T>(callback: (accumulator: T, step: ToolpathStep, index: number) => T, initial: T): T {
    let accumulator = initial;
    for (let index = 0; index < this.length; index += 1) {
      accumulator = callback(accumulator, unpackToolpathStep(this.packed, index), index);
    }
    return accumulator;
  }

  slice(start = 0, end = this.length): ToolpathStep[] {
    const from = Math.max(0, start < 0 ? this.length + start : start);
    const to = Math.min(this.length, end < 0 ? this.length + end : end);
    const sliced: ToolpathStep[] = [];
    for (let index = from; index < to; index += 1) {
      sliced.push(unpackToolpathStep(this.packed, index));
    }
    return sliced;
  }
}

/**
 * The same route over typed arrays when every step is representable, and the
 * original list when one is not. Callers read the result through
 * ToolpathStepList either way and never branch on which they got.
 */
export function packedToolpathSteps(steps: ToolpathStepList): ToolpathStepList {
  const packed = packToolpath(steps);
  return packed === null ? steps : new PackedToolpathSteps(packed);
}

/** The buffers behind a packed route, or null for one that is still an array. */
export function packedToolpathOf(steps: ToolpathStepList): PackedToolpath | null {
  return steps instanceof PackedToolpathSteps ? steps.packed : null;
}
