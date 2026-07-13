import { describe, expect, it } from 'vitest';
import { PROJECT_SCENE_LIMITS, validateSceneBudgets } from './project-scene-integrity-validator';

const EMPTY_CURVE = { start: { x: 0, y: 0 }, segments: [], closed: false };
const LINE_SEGMENT = { kind: 'line', to: { x: 1, y: 1 } };
const EXPECTED_CURVE_SUBPATH_LIMIT = 100_000;
const EXPECTED_CURVE_SEGMENT_LIMIT = 250_000;

function sceneWithCurves(curves: ReadonlyArray<unknown>): Record<string, unknown> {
  return {
    layers: [],
    groups: [],
    objects: [{ paths: [{ polylines: [], curves }] }],
  };
}

describe('project curve load budgets', () => {
  it('rejects excessive canonical curve subpaths before shape validation', () => {
    expect(PROJECT_SCENE_LIMITS.curveSubpaths).toBe(EXPECTED_CURVE_SUBPATH_LIMIT);
    const curves = Array(EXPECTED_CURVE_SUBPATH_LIMIT + 1).fill(EMPTY_CURVE);

    expect(validateSceneBudgets(sceneWithCurves(curves))).toMatch(/curves/);
  });

  it('rejects excessive canonical curve segments before shape validation', () => {
    expect(PROJECT_SCENE_LIMITS.curveSegments).toBe(EXPECTED_CURVE_SEGMENT_LIMIT);
    const segments = Array(EXPECTED_CURVE_SEGMENT_LIMIT + 1).fill(LINE_SEGMENT);

    expect(validateSceneBudgets(sceneWithCurves([{ ...EMPTY_CURVE, segments }]))).toMatch(
      /segments/,
    );
  });
});
