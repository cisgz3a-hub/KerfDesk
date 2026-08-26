import { describe, expect, it } from 'vitest';
import { validateSceneBudgets } from './project-scene-integrity-validator';

const EMPTY_CURVE = { start: { x: 0, y: 0 }, segments: [], closed: false };
const LINE_SEGMENT = { kind: 'line', to: { x: 1, y: 1 } };
const FORMER_CURVE_SUBPATH_LIMIT = 100_000;
const FORMER_CURVE_SEGMENT_LIMIT = 250_000;

function sceneWithCurves(curves: ReadonlyArray<unknown>): Record<string, unknown> {
  return {
    layers: [],
    groups: [],
    objects: [{ paths: [{ polylines: [], curves }] }],
  };
}

describe('project curve persistence', () => {
  it('does not reject valid dense canonical curve subpaths by content size alone', () => {
    const curves = Array(FORMER_CURVE_SUBPATH_LIMIT + 1).fill(EMPTY_CURVE);
    expect(validateSceneBudgets(sceneWithCurves(curves))).toBeNull();
  });

  it('does not reject valid dense canonical curve segments by content size alone', () => {
    const segments = Array(FORMER_CURVE_SEGMENT_LIMIT + 1).fill(LINE_SEGMENT);
    expect(validateSceneBudgets(sceneWithCurves([{ ...EMPTY_CURVE, segments }]))).toBeNull();
  });
});
