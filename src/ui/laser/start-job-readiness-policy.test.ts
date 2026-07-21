import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import {
  LARGE_JOB_PREPARATION_WARNING,
  largeJobPreparationWarning,
} from './start-job-readiness-policy';

const OVER_BUDGET_COLOR = '#ff0000';

function overBudgetVectorScene(): Scene {
  const base = createProject();
  const segments = Array.from({ length: 100_001 }, (_, index) => ({
    kind: 'line' as const,
    to: { x: index % 100, y: Math.floor(index / 100) },
  }));
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'over-budget',
    source: 'over-budget.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 1001 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: OVER_BUDGET_COLOR,
        polylines: [{ points: [{ x: 0, y: 0 }], closed: false }],
        curves: [{ start: { x: 0, y: 0 }, segments, closed: false }],
      },
    ],
  };
  return addLayer(
    addObject(base.scene, object),
    createLayer({ id: 'curve', color: OVER_BUDGET_COLOR }),
  );
}

function modestScene(): Scene {
  const base = createProject();
  const rect = createRectangle({
    id: 'rect',
    color: OVER_BUDGET_COLOR,
    spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
  });
  return addLayer(
    addObject(base.scene, rect),
    createLayer({ id: 'rect-layer', color: OVER_BUDGET_COLOR }),
  );
}

describe('largeJobPreparationWarning', () => {
  it('advises on a scene over the preparation segment budget instead of refusing (ADR-241)', () => {
    expect(largeJobPreparationWarning(overBudgetVectorScene())).toBe(LARGE_JOB_PREPARATION_WARNING);
  });

  it('stays silent for a modest scene', () => {
    expect(largeJobPreparationWarning(modestScene())).toBeNull();
  });
});
