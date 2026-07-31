import { expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';

it('does not let an unselected angleless V-carve operation block selected CNC output', () => {
  const prepared = prepareOutput(projectWithUnselectedInvalidVCarve(), {
    outputScope: {
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds: ['selected'],
    },
  });

  expect(prepared.ok).toBe(true);
  if (prepared.ok) {
    expect(prepared.job.groups).toHaveLength(1);
    expect(prepared.job.groups[0]).toMatchObject({ kind: 'cnc', layerId: 'valid-profile' });
  }
});

function projectWithUnselectedInvalidVCarve() {
  const base = createProject();
  const anglelessTool = {
    id: 'angleless-v-bit',
    name: 'Legacy angleless V-bit',
    kind: 'v-bit' as const,
    diameterMm: 3,
  };
  const invalid = {
    ...lineObject('unselected', 10),
    operationIds: ['invalid-v-carve'],
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
              { x: 20, y: 20 },
              { x: 10, y: 20 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  const selected = { ...lineObject('selected', 120), operationIds: ['valid-profile'] };
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: anglelessTool.id,
      tools: [anglelessTool],
    },
    scene: {
      objects: [invalid, selected],
      layers: [
        {
          ...createLayer({ id: 'invalid-v-carve', color: '#ff0000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' as const },
        },
        createLayer({ id: 'valid-profile', color: '#ff0000' }),
      ],
    },
  };
}

function lineObject(id: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}
