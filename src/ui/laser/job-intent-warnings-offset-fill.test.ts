import { describe, expect, it, vi } from 'vitest';

import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';

// The last hop of the offset-fill diagnostic chain. compile-job's own test pins
// that a failed offset reaches Job.diagnostics; this pins that Job Review
// actually renders it. Without this test a refactor could drop the final hop
// and every other test would still pass, which is exactly how a silent fill
// loss got shipped in the first place.
const offsetCheckedMock = vi.hoisted(() => vi.fn());

vi.mock('../../core/geometry/kerf-offset', () => ({
  offsetClosedPolylinesForKerf: () => [],
  offsetClosedPolylinesForKerfChecked: offsetCheckedMock,
}));

const { detectJobIntentWarnings } = await import('./job-intent-warnings');

const COLOR = '#ff0000';
const LAYER_NAME = 'Offset Fill';

const square: SceneObject = {
  kind: 'imported-svg',
  id: 'square',
  source: 'square.svg',
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: COLOR,
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          closed: true,
        },
      ],
    },
  ],
};

function offsetFillProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [square],
      layers: [
        {
          ...createLayer({ id: 'offset-fill-layer', name: LAYER_NAME, color: COLOR }),
          mode: 'fill' as const,
          fillStyle: 'offset' as const,
          output: true,
          visible: true,
          hatchSpacingMm: 1,
        },
      ],
    },
  };
}

function failOffset(): void {
  offsetCheckedMock.mockImplementation(() => ({
    kind: 'error',
    error: { kind: 'operation-failed', message: 'clipper2: pathological geometry' },
  }));
}

function succeedOffset(): void {
  offsetCheckedMock.mockImplementation(() => ({
    kind: 'ok',
    value: [
      {
        points: [
          { x: 5, y: 5 },
          { x: 15, y: 5 },
          { x: 15, y: 15 },
          { x: 5, y: 15 },
        ],
        closed: true,
      },
    ],
  }));
}

describe('detectJobIntentWarnings offset-fill diagnostics', () => {
  it('renders a warning naming the layer whose offset fill failed', () => {
    failOffset();

    const warnings = detectJobIntentWarnings(offsetFillProject());

    const offsetWarning = warnings.find((warning) => warning.includes(LAYER_NAME));
    expect(offsetWarning).toBeDefined();
    expect(offsetWarning).toContain('could not be fully generated');
    // The operator needs to know the outline is unaffected, or they will assume
    // the whole layer is lost and re-cut work that was fine.
    expect(offsetWarning).toContain('The outline still cuts');
  });

  it('warns without refusing - the warning is advisory, never a gate (rule 7)', () => {
    failOffset();

    // detectJobIntentWarnings returns strings only; there is no refusal channel
    // for it to use. Asserting the shape pins that: a future change that tried
    // to turn this into a block would have to change the return type.
    const warnings = detectJobIntentWarnings(offsetFillProject());

    expect(Array.isArray(warnings)).toBe(true);
    for (const warning of warnings) expect(typeof warning).toBe('string');
  });

  it('says nothing about offset fill when the offset succeeds', () => {
    succeedOffset();

    const warnings = detectJobIntentWarnings(offsetFillProject());

    expect(warnings.some((warning) => warning.includes('could not be fully generated'))).toBe(
      false,
    );
  });
});
