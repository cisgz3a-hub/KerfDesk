import { describe, expect, it, vi } from 'vitest';

import type * as Clipper2 from 'clipper2-ts';
import type { Polyline } from '../scene';

// rest-pocket walks its ring ladder on raw clipper paths, so a failure is
// injected by making the real inflatePathsD throw at a chosen call rather than
// by mocking the kerf-offset wrapper. Every other call runs the real clipper,
// which keeps the surrounding geometry honest. This lives beside
// rest-pocket.test.ts rather than inside it so the module-wide clipper mock
// cannot affect the placement tests there.
const inflate = vi.hoisted(() => ({
  calls: 0,
  throwOnCall: Number.POSITIVE_INFINITY,
  forceNonEmptyAtOrAfter: Number.POSITIVE_INFINITY,
}));

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Clipper2>();
  return {
    ...actual,
    inflatePathsD: (...args: Parameters<typeof actual.inflatePathsD>) => {
      inflate.calls += 1;
      if (inflate.calls >= inflate.throwOnCall) throw new Error('clipper2: pathological geometry');
      if (inflate.calls >= inflate.forceNonEmptyAtOrAfter) {
        return [
          [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
            { x: 1, y: 2 },
          ],
        ];
      }
      return actual.inflatePathsD(...args);
    },
  };
});

const { planRestPocketToolpaths } = await import('./rest-pocket');

const ROUGH_TOOL_MM = 6;
const FINISH_TOOL_MM = 2;
const STEPOVER_PERCENT = 40;
const SETUP_OFFSET_CALLS = 4;

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function planWith(throwOnCall: number): ReturnType<typeof planRestPocketToolpaths> {
  inflate.calls = 0;
  inflate.throwOnCall = throwOnCall;
  inflate.forceNonEmptyAtOrAfter = Number.POSITIVE_INFINITY;
  return planRestPocketToolpaths(
    [square(0, 0, 20)],
    ROUGH_TOOL_MM,
    FINISH_TOOL_MM,
    STEPOVER_PERCENT,
  );
}

describe('planRestPocketToolpaths offset-ladder failure', () => {
  it('does not cry failure when the rest region simply runs out of interior', () => {
    const clean = planWith(Number.POSITIVE_INFINITY);

    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(clean.toolpaths.length).toBeGreaterThan(0);
    expect(clean.completion).toBe('complete');
  });

  // The defect: clipper failing returns null and an exhausted region returns an
  // empty list, and the ladder broke on both. A truncated rest pass leaves the
  // very corner stock rest machining exists to remove, while looking complete.
  it('reports a clipper failure inside the ring ladder', () => {
    // The ladder runs last and its final offset is the one that ends it, so
    // throwing on the clean plan's LAST call lands squarely inside the ladder.
    const clean = planWith(Number.POSITIVE_INFINITY);
    const ladderCall = inflate.calls;
    expect(ladderCall).toBeGreaterThan(SETUP_OFFSET_CALLS);

    const failed = planWith(ladderCall);

    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.completion).toBe('geometry-failed');
    // Truncated, not void: the rings built before the failure still cut, and
    // the caller warns rather than discarding them.
    expect(failed.toolpaths.length).toBeGreaterThan(0);
    if (clean.ok) expect(failed.toolpaths.length).toBeLessThanOrEqual(clean.toolpaths.length);
  });

  it('still reports ok, so nothing downstream can turn this into a refusal (rule 7)', () => {
    const clean = planWith(Number.POSITIVE_INFINITY);
    const failed = planWith(inflate.calls);

    // A failed LADDER must not become a failed PLAN: `ok: false` would strip
    // the layer's toolpaths entirely and read as a compile-integrity error.
    expect(failed.ok).toBe(true);
    expect(clean.ok).toBe(true);
  });

  it('reports the fixed ring budget when a valid rest ladder still has interior', () => {
    inflate.calls = 0;
    inflate.throwOnCall = Number.POSITIVE_INFINITY;
    // Four setup inflations build the rest target. Every later ladder offset
    // remains valid and non-empty, so this crosses the real 4096-ring limit.
    inflate.forceNonEmptyAtOrAfter = SETUP_OFFSET_CALLS + 1;
    const limited = planRestPocketToolpaths(
      [square(0, 0, 20)],
      ROUGH_TOOL_MM,
      FINISH_TOOL_MM,
      STEPOVER_PERCENT,
    );

    expect(limited).toMatchObject({ ok: true, completion: 'pass-limit' });
    if (!limited.ok) return;
    // The target can contain several disconnected rest corners, so toolpath
    // count is not ring count. Reaching this threshold proves every one of
    // the 4096 permitted levels produced geometry before the cap ended it.
    expect(limited.toolpaths.length).toBeGreaterThanOrEqual(4096);
  });
});
