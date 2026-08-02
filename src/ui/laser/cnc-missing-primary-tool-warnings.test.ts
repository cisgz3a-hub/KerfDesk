import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { detectCncMissingPrimaryToolWarnings } from './cnc-missing-primary-tool-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

function projectWithToolId(toolId: string | undefined, output = true): Project {
  const layer = {
    ...createLayer({ id: 'red', color: '#ff0000' }),
    name: 'Profile cut',
    output,
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      ...(toolId === undefined ? {} : { toolId }),
    },
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [artwork], layers: [layer] },
  };
}

const artwork: SceneObject = {
  kind: 'imported-svg',
  id: 'profile-artwork',
  source: 'profile.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('detectCncMissingPrimaryToolWarnings', () => {
  it('names the missing requested bit and the active fallback used by compile', () => {
    const warnings = detectCncMissingPrimaryToolWarnings(projectWithToolId('deleted-bit'));

    expect(warnings).toEqual([
      'Operation "Profile cut" requests missing bit "deleted-bit". Output will use the active bit "3.175 mm (1/8") end mill" instead; verify the bit and its feed, plunge, RPM, and depth/pass before cutting.',
    ]);
  });

  it('joins the shared Start and Save warning set without becoming a refusal', () => {
    expect(detectMachineJobWarnings(projectWithToolId('deleted-bit'))).toContain(
      detectCncMissingPrimaryToolWarnings(projectWithToolId('deleted-bit'))[0],
    );
  });

  it('is silent for a valid explicit bit, active-bit following, disabled output, and laser mode', () => {
    expect(detectCncMissingPrimaryToolWarnings(projectWithToolId('em-3175'))).toEqual([]);
    expect(detectCncMissingPrimaryToolWarnings(projectWithToolId(undefined))).toEqual([]);
    expect(detectCncMissingPrimaryToolWarnings(projectWithToolId('deleted-bit', false))).toEqual(
      [],
    );
    expect(detectCncMissingPrimaryToolWarnings(createProject())).toEqual([]);
  });

  it('is silent when no artwork compiles through the stale layer', () => {
    const project = projectWithToolId('deleted-bit');
    expect(
      detectCncMissingPrimaryToolWarnings({
        ...project,
        scene: { ...project.scene, objects: [] },
      }),
    ).toEqual([]);
  });
});
