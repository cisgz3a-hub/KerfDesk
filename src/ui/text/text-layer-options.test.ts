import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import { initialTextLayerColor, nextTextLayerColor, textLayerOptions } from './text-layer-options';

function cncProject(): Project {
  const base = createProject();
  const box = {
    ...createLayer({ id: '#ff0000', color: '#ff0000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      depthMm: DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm,
    },
  };
  return {
    ...base,
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: 'vb-60' },
    scene: { ...base.scene, layers: [box] },
  };
}

describe('text output layer policy', () => {
  it('starts CNC text on a new shallow operation instead of the active through-cut layer', () => {
    const project = cncProject();
    const color = initialTextLayerColor({ mode: 'add' }, project, '#ff0000');

    expect(color).toBe(nextTextLayerColor(project));
    expect(color).not.toBe('#ff0000');
    expect(textLayerOptions(project, 'roboto-regular', color).at(-1)).toMatchObject({
      color,
      label: 'New text layer',
      summary: expect.stringContaining('V-carve'),
      isNew: true,
    });
  });

  it('warns when an existing operation can cut text through the stock', () => {
    expect(textLayerOptions(cncProject(), 'roboto-regular')[0]?.notice).toEqual({
      kind: 'warning',
      message: 'This operation reaches the stock thickness and may cut the text through.',
    });
  });

  it('blocks single-line text on V-carve while allowing its new engrave layer', () => {
    const project = cncProject();
    const vCarveProject: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({
          ...layer,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
        })),
      },
    };
    const options = textLayerOptions(vCarveProject, 'hershey-simplex');

    expect(options[0]?.notice).toMatchObject({ kind: 'error' });
    expect(options.at(-1)).toMatchObject({
      summary: expect.stringContaining('Engrave'),
    });
    expect(options.at(-1)?.notice).toBeUndefined();
  });

  it('keeps laser text on the active layer and exposes its power and speed', () => {
    const base = createProject();
    const layer = { ...createLayer({ id: '#00ff00', color: '#00ff00' }), power: 72, speed: 900 };
    const project = { ...base, scene: { ...base.scene, layers: [layer] } };

    expect(initialTextLayerColor({ mode: 'add' }, project, '#00ff00')).toBe('#00ff00');
    expect(textLayerOptions(project, 'roboto-regular')[0]?.summary).toBe(
      'Line · 72% power · 900 mm/min',
    );
  });
});
