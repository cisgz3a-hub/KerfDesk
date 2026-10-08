import { describe, expect, it } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
  type SceneObject,
} from '../scene';
import { defaultCncMachiningSetup } from '../scene/cnc-machining-setup';
import { cncDependencyStatuses, cncPreparationInputs } from './cnc-preparation-dependencies';

function project(): Project {
  const base = projectWithLine();
  const source = base.scene.objects[0]!;
  const layers = ['A', 'B'].map((id) => ({
    ...createLayer({ id, color: id === 'A' ? '#000000' : '#ff0000', name: id }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId },
  }));
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...base.scene,
      layers,
      objects: [
        {
          ...source,
          id: 'shared',
          paths: [
            {
              color: '#000000',
              operationIds: ['A'],
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
            {
              color: '#ff0000',
              operationIds: ['B'],
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 3 },
                    { x: 10, y: 3 },
                  ],
                },
              ],
            },
          ],
        } as SceneObject,
      ],
    },
  };
}
function statuses(current: Project, previous: Project) {
  return cncDependencyStatuses(cncPreparationInputs(current), cncPreparationInputs(previous));
}
describe('CNC preparation dependency evidence', () => {
  it('keeps a label change ready without retaining an executable cache', () => {
    const base = project();
    const renamed = {
      ...base,
      notes: 'annotation',
      scene: {
        ...base.scene,
        layers: base.scene.layers.map((layer) => ({ ...layer, name: 'New ' + layer.name })),
      },
    };
    expect(statuses(renamed, base).map((item) => item.status)).toEqual(['ready', 'ready']);
  });
  it('invalidates only the operation using an edited path on shared artwork', () => {
    const base = project(),
      object = base.scene.objects[0]!;
    if (!('paths' in object)) throw new Error('not vector');
    const current = {
      ...base,
      scene: {
        ...base.scene,
        objects: [
          {
            ...object,
            paths: object.paths.map((path, i) =>
              i === 1
                ? {
                    ...path,
                    polylines: [
                      {
                        closed: false,
                        points: [
                          { x: 0, y: 3 },
                          { x: 15, y: 3 },
                        ],
                      },
                    ],
                  }
                : path,
            ),
          },
        ],
      },
    };
    const result = statuses(current, base);
    expect(result.map((item) => item.status)).toEqual(['ready', 'dirty']);
    expect(result[1]?.reasons).toContain('Source boundary, placement or relief field changed');
  });
  it('tracks cutter, stock and fixture changes and distinguishes a new session', () => {
    const base = project();
    const changed = {
      ...base,
      cncSetup: {
        ...defaultCncMachiningSetup(),
        fixtures: [
          {
            id: 'F',
            name: 'Clamp',
            xMm: 0,
            yMm: 0,
            widthMm: 5,
            heightMm: 5,
            bottomZMm: 0,
            topZMm: 10,
          },
        ],
      },
    };
    expect(
      statuses(changed, base).every((item) =>
        item.reasons.includes('Fixture or tool assembly review changed'),
      ),
    ).toBe(true);
    expect(cncDependencyStatuses(cncPreparationInputs(base)).map((item) => item.status)).toEqual([
      'not-prepared',
      'not-prepared',
    ]);
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: DEFAULT_CNC_MACHINE_CONFIG.tools.map((tool) => ({
        ...tool,
        diameterMm: tool.diameterMm * 1.1,
      })),
    };
    expect(
      statuses({ ...base, machine }, base).every((item) => item.reasons.includes('Cutter changed')),
    ).toBe(true);
  });
});
