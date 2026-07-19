import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type ShapeObject } from '../../core/scene';
import { useStore } from './store';

afterEach(() => {
  useStore.getState().newProject();
});

describe('project air assist default sync', () => {
  it('enables Job Air defaults without guessing an unverified M7/M8 hardware output', () => {
    const redLayer = { ...createLayer({ id: '#ff0000', color: '#ff0000' }), airAssist: false };
    const blueLayer = {
      ...createLayer({ id: '#0000ff', color: '#0000ff' }),
      output: false,
      airAssist: false,
    };
    const object = shapeOnLayer('#ff0000', { airAssist: false, power: 70 });
    useStore.getState().setProject({
      ...createProject(),
      scene: { layers: [redLayer, blueLayer], objects: [object], groups: [] },
    });

    const summary = useStore.getState().syncProjectAirAssistDefaults();
    const state = useStore.getState();

    expect(summary).toMatchObject({
      airOutputUnset: true,
      disabledOutputLayerCount: 1,
      disabledObjectOverrideCount: 1,
    });
    expect(state.project.device.airAssistCommand).toBe('none');
    expect(state.project.scene.layers.find((layer) => layer.id === '#ff0000')?.airAssist).toBe(
      true,
    );
    expect(state.project.scene.layers.find((layer) => layer.id === '#0000ff')?.airAssist).toBe(
      false,
    );
    expect(state.project.scene.objects[0]?.operationOverride).toMatchObject({
      airAssist: true,
      power: 70,
    });
  });
});

function shapeOnLayer(
  color: string,
  operationOverride: ShapeObject['operationOverride'],
): ShapeObject {
  const shape: ShapeObject = {
    kind: 'shape',
    id: 'shape-1',
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  return operationOverride === undefined ? shape : { ...shape, operationOverride };
}
