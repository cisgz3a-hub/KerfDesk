import { describe, expect, it } from 'vitest';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project sublayer persistence', () => {
  it('round-trips canonical sublayer identity and settings', () => {
    const base = createLayer({ id: 'engrave', color: '#ff0000' });
    const subLayer = createLayerSubLayer(base, {
      id: 'sub-7',
      label: 'Fine finish',
      settings: {
        ...captureLayerOperationSettings(base),
        mode: 'fill',
        power: 17,
        speed: 888,
      },
    });
    const project = {
      ...createProject(),
      scene: { objects: [], groups: [], layers: [{ ...base, subLayers: [subLayer] }] },
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.layers[0]?.subLayers).toEqual([subLayer]);
    }
  });
});
