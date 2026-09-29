import { describe, expect, it } from 'vitest';
import type { Job } from '../../core/job';
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
  preparedProgramIntegrityIssue,
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

// ADR-459 Amd 1: a small fill whose dense outline exhausts the bounded estimate
// is 'unknown', so the compiled job's real Fill span count decides.
describe('largeJobPreparationWarning with an unknown fill estimate', () => {
  function denseSmallCircleFill(): Scene {
    const color = '#0000ff';
    const points = Array.from({ length: 12_000 }, (_, index) => {
      const angle = (index / 12_000) * Math.PI * 2;
      return { x: 5 + 5 * Math.cos(angle), y: 5 + 5 * Math.sin(angle) };
    });
    const object: SceneObject = {
      kind: 'imported-svg',
      id: 'dense-circle',
      source: 'dense-circle.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color, polylines: [{ points, closed: true }] }],
    };
    return {
      objects: [object],
      layers: [{ ...createLayer({ id: 'fill', color, mode: 'fill' }), hatchSpacingMm: 0.1 }],
    };
  }
  function jobWithFillSpans(count: number): Job {
    return {
      groups: [{ kind: 'fill', segments: Array.from({ length: count }, () => ({})) }],
    } as unknown as Job;
  }

  it('stays silent before compile and for a small compiled fill', () => {
    const scene = denseSmallCircleFill();
    expect(largeJobPreparationWarning(scene)).toBeNull();
    expect(largeJobPreparationWarning(scene, jobWithFillSpans(100))).toBeNull();
  });

  it('advises when the compiled fill really is over the budget', () => {
    expect(largeJobPreparationWarning(denseSmallCircleFill(), jobWithFillSpans(20_001))).toBe(
      LARGE_JOB_PREPARATION_WARNING,
    );
  });
});

// Controller audit S-3: Frame prepares the same program Start sends, so a line
// the connected controller's parser cannot hold is refused there, before any
// motion, rather than after a completed Frame. Stock GRBL keeps 79 significant
// characters, grblHAL 256
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.h#L31-L32,
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.h#L35-L36).
describe('preparedProgramIntegrityIssue line buffer', () => {
  const NO_PREFLIGHT = { issues: [] };
  const program = `G21\nG1 X${'1'.repeat(77)}\nM5\n`;

  it('refuses Frame for a line the connected GRBL parser cannot hold', () => {
    expect(preparedProgramIntegrityIssue(program, 1024, NO_PREFLIGHT, 'grbl-v1.1')).toEqual([
      'G-code line 2 has 80 significant characters — stock GRBL accepts at most 79 per line ' +
        '(spaces and comments do not count) before error:11. Job not framed or started.',
    ]);
  });

  it('keeps the line for a controller whose parser holds it or is not described', () => {
    for (const kind of ['grblhal', 'fluidnc', 'marlin', undefined] as const) {
      expect(preparedProgramIntegrityIssue(program, 1024, NO_PREFLIGHT, kind)).toBeNull();
    }
  });
});
