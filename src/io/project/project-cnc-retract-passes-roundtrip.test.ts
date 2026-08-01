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

// ADR-253 retractBetweenPasses is a persisted per-layer CncLayerSettings flag
// (default-on at compile). Like every other optional CNC field it must be on
// the normalize whitelist, or an operator's explicit OFF is dropped on Open and
// — because Save re-validates and rejects a semantic drift — a project that
// turned it off could not be saved at all.

function retractProject(retractBetweenPasses: boolean): Project {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      retractBetweenPasses,
    },
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

describe('.lf2 CNC retract-between-passes round-trip (ADR-253)', () => {
  it('round-trips the explicit OFF override', () => {
    const loaded = deserializeOk(serializeProject(retractProject(false)));
    expect(loaded.scene.layers[0]?.cnc?.retractBetweenPasses).toBe(false);
  });

  it('round-trips an explicit ON', () => {
    const loaded = deserializeOk(serializeProject(retractProject(true)));
    expect(loaded.scene.layers[0]?.cnc?.retractBetweenPasses).toBe(true);
  });

  it('drops a non-boolean value so the compile default applies by omission', () => {
    const raw = JSON.parse(serializeProject(retractProject(false))) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
    const layer = scene.layers[0] as Record<string, unknown>;
    layer['cnc'] = { ...DEFAULT_CNC_LAYER_SETTINGS, retractBetweenPasses: 'yes' };
    expect(
      deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.retractBetweenPasses,
    ).toBeUndefined();
  });

  it('saves a project that turned retract off without a validation drift', () => {
    const prepared = prepareProjectForPersistence(retractProject(false));
    expect(prepared.kind).toBe('ok');
    if (prepared.kind !== 'ok') return;
    expect(prepared.project.scene.layers[0]?.cnc?.retractBetweenPasses).toBe(false);
  });
});
