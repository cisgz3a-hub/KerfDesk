import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function cncProject(): Project {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 4, cutType: 'pocket' as const },
  };
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { ...base.scene, layers: [layer] },
  };
}

function deserializeOk(text: string): Project {
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project;
}

describe('.lf2 machine / cnc round-trip', () => {
  it('round-trips a CNC project: machine config and layer cnc settings', () => {
    const project = cncProject();
    const loaded = deserializeOk(serializeProject(project));
    expect(loaded.machine).toEqual(DEFAULT_CNC_MACHINE_CONFIG);
    expect(loaded.scene.layers[0]?.cnc).toEqual({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      depthMm: 4,
      cutType: 'pocket',
    });
  });

  it('loads a legacy project without machine as a laser project', () => {
    const loaded = deserializeOk(serializeProject(createProject()));
    expect(loaded.machine).toBeUndefined();
  });

  it('drops an unrecognized machine kind', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['machine'] = { kind: 'plasma' };
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(loaded.machine).toBeUndefined();
  });

  it('rebuilds malformed CNC machine values from defaults', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    raw['machine'] = {
      kind: 'cnc',
      stock: { thicknessMm: -5 },
      tools: 'nonsense',
      toolId: 42,
      params: { safeZMm: 0, spindleMaxRpm: 'fast' },
    };
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(loaded.machine).toEqual(DEFAULT_CNC_MACHINE_CONFIG);
  });

  it('replaces a malformed layer cnc block with defaults and drops non-objects', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
    const layer = scene.layers[0] as Record<string, unknown>;
    layer['cnc'] = { cutType: 'zigzag', depthMm: 0, feedMmPerMin: 'quick' };
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(loaded.scene.layers[0]?.cnc).toEqual(DEFAULT_CNC_LAYER_SETTINGS);

    layer['cnc'] = 'garbage';
    const dropped = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(dropped.scene.layers[0]?.cnc).toBeUndefined();
  });
});
