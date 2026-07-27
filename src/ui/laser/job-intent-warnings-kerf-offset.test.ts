import { describe, expect, it, vi } from 'vitest';

import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';

// The last hop of the kerf-offset diagnostic chain. compile-job's own test pins
// that a failed kerf offset reaches Job.diagnostics; this pins that Job Review
// actually renders it. Without this test a refactor could drop the final hop and
// every other test would still pass — which is exactly how the sibling silent
// fill loss got shipped.
const offsetCheckedMock = vi.hoisted(() => vi.fn());

vi.mock('../../core/geometry/kerf-offset', () => ({
  offsetClosedPolylinesForKerf: () => [],
  offsetClosedPolylinesForKerfChecked: offsetCheckedMock,
}));

const { detectJobIntentWarnings } = await import('./job-intent-warnings');

const COLOR = '#ff0000';
const LAYER_NAME = 'Outline Cut';
const KERF_OFFSET_MM = 0.1;

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

function kerfLineProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [square],
      layers: [
        {
          ...createLayer({ id: 'cut-layer', name: LAYER_NAME, color: COLOR }),
          mode: 'line' as const,
          output: true,
          visible: true,
          kerfOffsetMm: KERF_OFFSET_MM,
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
          { x: -0.1, y: -0.1 },
          { x: 20.1, y: -0.1 },
          { x: 20.1, y: 20.1 },
          { x: -0.1, y: 20.1 },
        ],
        closed: true,
      },
    ],
  }));
}

describe('detectJobIntentWarnings kerf-offset diagnostics', () => {
  it('renders a warning naming the layer whose kerf offset failed', () => {
    failOffset();

    const warnings = detectJobIntentWarnings(kerfLineProject());

    const kerfWarning = warnings.find((warning) => warning.includes(LAYER_NAME));
    expect(kerfWarning).toBeDefined();
    expect(kerfWarning).toContain('Kerf offset');
    // The operator must know the part will NOT be cut — unlike the offset-fill
    // case, there is no surviving outline to fall back on.
    expect(kerfWarning).toContain('will NOT be cut');
  });

  it('does not reuse the offset-fill wording, which promises a surviving outline', () => {
    failOffset();

    const warnings = detectJobIntentWarnings(kerfLineProject());

    expect(warnings.some((warning) => warning.includes('The outline still cuts'))).toBe(false);
  });

  it('warns without refusing - the warning is advisory, never a gate (rule 7)', () => {
    failOffset();

    // detectJobIntentWarnings returns strings only; there is no refusal channel
    // for it to use. Asserting the shape pins that: a future change that tried
    // to turn this into a block would have to change the return type.
    const warnings = detectJobIntentWarnings(kerfLineProject());

    expect(Array.isArray(warnings)).toBe(true);
    for (const warning of warnings) expect(typeof warning).toBe('string');
  });

  it('says nothing about kerf offset when the offset succeeds', () => {
    succeedOffset();

    const warnings = detectJobIntentWarnings(kerfLineProject());

    expect(warnings.some((warning) => warning.includes('Kerf offset'))).toBe(false);
  });
});
