import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

// ADR-422 Amendment 1: a relief layer's slope step survives a save and load,
// and a value that is not a positive number is dropped, leaving it off.

function loadWithSlopeStep(reliefFineStepMm: unknown): unknown {
  const base = createProject();
  const project = {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...base.scene,
      layers: [{ ...createLayer({ id: 'L1', color: '#a0522d' }), cnc: DEFAULT_CNC_LAYER_SETTINGS }],
    },
  };
  const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
  const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
  scene.layers[0] = {
    ...scene.layers[0],
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, reliefFineStepMm },
  };
  const result = deserializeProject(`${JSON.stringify(raw)}\n`);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project.scene.layers[0]?.cnc?.reliefFineStepMm;
}

describe('relief slope step in project files (ADR-422 Amendment 1)', () => {
  it('round-trips a positive slope step', () => {
    expect(loadWithSlopeStep(0.3)).toBe(0.3);
  });

  it('drops zero, negative and non-numeric values', () => {
    expect(loadWithSlopeStep(0)).toBeUndefined();
    expect(loadWithSlopeStep(-1)).toBeUndefined();
    expect(loadWithSlopeStep('0.3')).toBeUndefined();
  });
});
