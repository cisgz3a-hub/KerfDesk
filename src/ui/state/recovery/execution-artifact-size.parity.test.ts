import { describe, expect, it } from 'vitest';
import { estimateExecutionArtifactBytes } from './execution-artifact-size';
import { legacyEstimateExecutionArtifactBytes } from './execution-artifact-size-oracle.test-support';

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

class Opaque {
  readonly value = 1;
}

type Next = () => number;
type Make = (next: Next, depth: number, shared: unknown[]) => unknown;

function arrayOf(next: Next, depth: number, shared: unknown[]): unknown {
  const values = Array.from({ length: Math.floor(next() * 5) }, () =>
    graph(next, depth + 1, shared),
  );
  if (next() < 0.2) delete values[0];
  shared.push(values);
  return values;
}

function recordOf(next: Next, depth: number, shared: unknown[]): unknown {
  const record: Record<string, unknown> = {};
  for (let index = 0; index < Math.floor(next() * 5); index += 1) {
    record[`k${index}${'x'.repeat(Math.floor(next() * 3))}`] = graph(next, depth + 1, shared);
  }
  shared.push(record);
  return record;
}

function binaryOf(next: Next, _depth: number, shared: unknown[]): unknown {
  const buffer = new ArrayBuffer(Math.floor(next() * 64));
  const views = [new Uint8Array(buffer), new Float64Array(buffer, 0, 0), buffer];
  shared.push(views[0]);
  return views[Math.floor(next() * views.length)];
}

// Every kind of value the walk distinguishes, nested and shared, so the new
// plain-container fast path must agree with the old order of checks.
const MAKERS: ReadonlyArray<Make> = [
  (next) => next() * 1000,
  (next) => 'G1X12.5Y3 ✓'.slice(0, Math.floor(next() * 12)),
  (next) => (next() < 0.5 ? null : undefined),
  (next) => next() < 0.5,
  (next, _depth, shared) => (shared.length > 0 ? shared[Math.floor(next() * shared.length)] : 7),
  (next) => (next() < 0.5 ? () => undefined : Symbol('s')),
  arrayOf,
  recordOf,
  recordOf,
  (next, depth, shared) => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['a'] = graph(next, depth + 1, shared);
    return bare;
  },
  binaryOf,
  () => (typeof SharedArrayBuffer === 'undefined' ? 1 : new SharedArrayBuffer(8)),
  (next, depth, shared) => new Map<unknown, unknown>([[graph(next, depth + 1, shared), 1]]),
  (next, depth, shared) => new Set([graph(next, depth + 1, shared)]),
  (next) => (next() < 0.5 ? new Date(0) : /g1/gi),
  (next, depth, shared) => (next() < 0.5 ? new Opaque() : [graph(next, depth + 1, shared)]),
];

function graph(next: Next, depth: number, shared: unknown[]): unknown {
  const pick = Math.floor(next() * (depth > 4 ? 6 : MAKERS.length));
  return (MAKERS[pick] ?? MAKERS[0])?.(next, depth, shared);
}

describe('execution artifact size estimate', () => {
  it('matches the previous walk byte for byte over fuzzed graphs and limits', () => {
    for (let seed = 1; seed <= 3000; seed += 1) {
      const next = random(seed);
      const shared: unknown[] = [];
      const value = { job: graph(next, 0, shared), gcode: 'G0 X1\n'.repeat(seed % 7) };
      const limit = [Number.MAX_SAFE_INTEGER, 64, 400, 4096][seed % 4] ?? Number.MAX_SAFE_INTEGER;
      const allowFunctions = seed % 3 === 0;
      expect(estimateExecutionArtifactBytes(value, limit, allowFunctions)).toBe(
        legacyEstimateExecutionArtifactBytes(value, limit, allowFunctions),
      );
    }
  });
});
