import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

// ADR-491: the pocket "Lift between rings" choice and the machine park height
// are persisted like every other optional CNC field, so an operator's choice
// survives Open and Save re-validation.

function project(pocketLiftBetweenRings: boolean, parkZMm: number): Project {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const, pocketLiftBetweenRings },
  };
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, parkZMm },
    },
    scene: { ...base.scene, layers: [layer] },
  };
}

function parkZMm(loaded: Project): number | undefined {
  const machine = loaded.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
  return machine.params.parkZMm;
}

function deserializeOk(text: string): Project {
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project;
}

describe('.lf2 stay-down pocket and park height round-trip (ADR-491)', () => {
  it('round-trips Lift between rings and the park height', () => {
    for (const lift of [true, false]) {
      const loaded = deserializeOk(serializeProject(project(lift, 25)));
      expect(loaded.scene.layers[0]?.cnc?.pocketLiftBetweenRings).toBe(lift);
      expect(parkZMm(loaded)).toBe(25);
    }
  });

  it('drops an unusable park height so the job parks at safe Z', () => {
    const raw = JSON.parse(serializeProject(project(false, 25))) as {
      machine: { params: Record<string, unknown> };
    };
    raw.machine.params['parkZMm'] = -4;
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(parkZMm(loaded)).toBeUndefined();
  });

  it('saves both without a validation drift', () => {
    const prepared = prepareProjectForPersistence(project(true, 25));
    expect(prepared.kind).toBe('ok');
  });
});
