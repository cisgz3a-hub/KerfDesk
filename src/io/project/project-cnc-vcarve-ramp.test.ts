import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function loadWithEntry(vCarveRampEntryDeg: unknown, rampEntryDeg: unknown): unknown {
  const base = createProject();
  const project = {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#ff0000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' as const },
        },
      ],
    },
  };
  const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
  const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
  scene.layers[0] = {
    ...scene.layers[0],
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve', vCarveRampEntryDeg, rampEntryDeg },
  };
  const result = deserializeProject(`${JSON.stringify(raw)}\n`);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project.scene.layers[0]?.cnc;
}

describe('.lf2 V-carve ramp opt-in', () => {
  it('round-trips the V-carve-specific value without reinterpreting a generic ramp', () => {
    expect(loadWithEntry(3, 7)).toMatchObject({
      cutType: 'v-carve',
      vCarveRampEntryDeg: 3,
      rampEntryDeg: 7,
    });
  });

  it('drops a malformed V-carve value while retaining the independent generic field', () => {
    expect(loadWithEntry(-1, 7)).toMatchObject({
      cutType: 'v-carve',
      rampEntryDeg: 7,
    });
    expect(loadWithEntry(-1, 7)).not.toHaveProperty('vCarveRampEntryDeg');
  });
});
