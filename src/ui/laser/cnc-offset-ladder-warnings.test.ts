import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';

// The last hop of the CNC offset-ladder chain. Without a test here a refactor
// could drop the final hop and every other test would still pass — which is
// exactly how the laser-side offset-fill loss shipped in the first place.
const offsetChecked = vi.hoisted(() => vi.fn());

vi.mock('../../core/geometry/kerf-offset', () => ({
  offsetClosedPolylinesForKerf: () => [],
  offsetClosedPolylinesForKerfChecked: offsetChecked,
  offsetClosedPolylinesWithRoundJoins: () => [],
}));

const { detectCncOffsetLadderWarnings } = await import('./cnc-offset-ladder-warnings');
const { detectMachineJobWarnings } = await import('./machine-job-warnings');

const COLOR = '#ff0000';
const LAYER_NAME = 'Tray pocket';

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

function pocketProject(): Project {
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [square],
      layers: [
        {
          ...createLayer({ id: 'pocket-layer', name: LAYER_NAME, color: COLOR }),
          output: true,
          visible: true,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const },
        },
      ],
    },
  };
}

function ringAt(insetMm: number): unknown {
  return {
    kind: 'ok',
    value: [
      {
        closed: true,
        points: [
          { x: insetMm, y: insetMm },
          { x: 20 - insetMm, y: insetMm },
          { x: 20 - insetMm, y: 20 - insetMm },
          { x: insetMm, y: 20 - insetMm },
        ],
      },
    ],
  };
}

const ENGINE_FAILURE: unknown = {
  kind: 'error',
  error: { kind: 'operation-failed', message: 'clipper2: pathological geometry' },
};

// One good ring, then the engine gives up: the pocket is truncated, not done.
function failAfterFirstRing(): void {
  offsetChecked.mockReset();
  offsetChecked.mockReturnValueOnce(ringAt(1.6));
  offsetChecked.mockReturnValue(ENGINE_FAILURE);
}

// One good ring, then no interior left: the pocket is genuinely finished.
function exhaustAfterFirstRing(): void {
  offsetChecked.mockReset();
  offsetChecked.mockReturnValueOnce(ringAt(1.6));
  offsetChecked.mockReturnValue({ kind: 'ok', value: [] });
}

describe('detectCncOffsetLadderWarnings', () => {
  it('warns, naming the layer, when the offset ladder fails partway', () => {
    failAfterFirstRing();

    const warnings = detectCncOffsetLadderWarnings(pocketProject());

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(LAYER_NAME);
    expect(warnings[0]).toContain('could not be fully generated');
    // The operator needs to know the generated passes still cut, or they will
    // assume the whole layer is lost and re-cut work that was fine.
    expect(warnings[0]).toContain('still');
  });

  // The defect: both endings produce an empty ring, and only one of them is a
  // finished pocket. Conflating them is what let a truncated toolpath ship.
  it('stays silent when the ladder simply runs out of interior', () => {
    exhaustAfterFirstRing();

    expect(detectCncOffsetLadderWarnings(pocketProject())).toEqual([]);
  });

  it('warns without refusing — advisory only, never a gate (rule 7)', () => {
    failAfterFirstRing();

    // The function returns strings and nothing else; there is no refusal
    // channel for it to use. Pinning the shape means a future change that
    // tried to turn this into a block would have to change the return type.
    const warnings = detectCncOffsetLadderWarnings(pocketProject());

    expect(Array.isArray(warnings)).toBe(true);
    for (const warning of warnings) expect(typeof warning).toBe('string');
  });

  it('reaches the shared CNC advisory set that Job Review and Save render', () => {
    failAfterFirstRing();

    const warnings = detectMachineJobWarnings(pocketProject());

    expect(warnings.some((warning) => warning.includes('could not be fully generated'))).toBe(true);
  });

  it('returns nothing for a laser project', () => {
    failAfterFirstRing();

    expect(detectCncOffsetLadderWarnings(createProject())).toEqual([]);
  });

  it('ignores a layer with Output off', () => {
    failAfterFirstRing();
    const project = pocketProject();
    const [layer] = project.scene.layers;
    if (layer === undefined) throw new Error('fixture must have a layer');
    const withoutOutput: Project = {
      ...project,
      scene: { ...project.scene, layers: [{ ...layer, output: false }] },
    };

    expect(detectCncOffsetLadderWarnings(withoutOutput)).toEqual([]);
  });
});
