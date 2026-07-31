import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  validateOutputScope,
  type CncLayerSettings,
  type Project,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { detectCncAngledToolFeedWarnings } from './cnc-angled-tool-feed-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

function cncProject(
  settings: CncLayerSettings,
  options: { readonly output?: boolean; readonly used?: boolean } = {},
): Project {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    ...(options.output === undefined ? {} : { output: options.output }),
    cnc: settings,
  };
  const object = createRectangle({
    id: 'R1',
    color: layer.color,
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  });
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: options.used === false ? [] : [object], layers: [layer] },
  };
}

function materialSettings(toolId: string): CncLayerSettings {
  return {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    toolId,
    feedMmPerMin: 300,
    plungeMmPerMin: 120,
    spindleRpm: 12_000,
    depthPerPassMm: 0.75,
    materialKey: 'plywood-mdf',
    feedSource: { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 2 },
  };
}

describe('detectCncAngledToolFeedWarnings', () => {
  it.each([
    ['vb-90', '90° V-bit', '12.7 mm', '90°'],
    ['eng-15', '15° engraving bit', '3.175 mm', '15°'],
  ])('warns for output material-recipe angled tool %s', (toolId, name, diameter, angle) => {
    const [warning, ...rest] = detectCncAngledToolFeedWarnings(
      cncProject(materialSettings(toolId)),
    );
    expect(rest).toEqual([]);
    expect(warning).toContain(`Layer L1 uses automatic material values for ${name}`);
    expect(warning).toContain(`stored ${diameter} diameter band`);
    expect(warning).toContain(`${angle} included angle`);
    expect(warning).toContain('feed 300 mm/min');
    expect(warning).toContain('plunge 120 mm/min');
    expect(warning).toContain('spindle 12000 RPM');
    expect(warning).toContain('0.75 mm/pass');
  });

  it('is wired into the shared Job Review warning collector', () => {
    expect(detectMachineJobWarnings(cncProject(materialSettings('vb-90'))).join(' ')).toContain(
      'V-bit rough guide',
    );
  });

  it('is silent when selected-output scoping removes the angled operation', () => {
    const angled = cncProject(materialSettings('vb-90'));
    const endMillLayer = {
      ...createLayer({ id: 'L2', color: '#00ff00' }),
      cnc: materialSettings('em-3175'),
    };
    const endMillObject = createRectangle({
      id: 'R2',
      color: endMillLayer.color,
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const full = {
      ...angled,
      scene: {
        ...angled.scene,
        objects: [...angled.scene.objects, endMillObject],
        layers: [...angled.scene.layers, endMillLayer],
      },
    };
    const scoped = validateOutputScope(full.scene, {
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds: ['R2'],
    });
    if (!scoped.ok) throw new Error('selected scope failed');

    expect(detectCncAngledToolFeedWarnings({ ...full, scene: scoped.scene })).toEqual([]);
  });

  it('is silent for an end mill, manual angled values, and a non-output or unused layer', () => {
    expect(detectCncAngledToolFeedWarnings(cncProject(materialSettings('em-3175')))).toEqual([]);
    expect(
      detectCncAngledToolFeedWarnings(
        cncProject({ ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'vb-90' }),
      ),
    ).toEqual([]);
    expect(
      detectCncAngledToolFeedWarnings(cncProject(materialSettings('vb-90'), { output: false })),
    ).toEqual([]);
    expect(
      detectCncAngledToolFeedWarnings(cncProject(materialSettings('vb-90'), { used: false })),
    ).toEqual([]);
  });

  it('is silent for laser projects', () => {
    expect(detectCncAngledToolFeedWarnings(createProject())).toEqual([]);
  });
});
