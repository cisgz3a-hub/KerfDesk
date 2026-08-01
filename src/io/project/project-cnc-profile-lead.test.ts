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

// ADR-250 per-layer profile lead-in/out (profileLead) is a shipped
// CncLayerSettings field. Normalization rebuilds the cnc block from a field
// whitelist, so profileLead must be listed there or it is silently dropped on
// Open — and, because Save re-validates and rejects a semantic drift, a project
// carrying a lead could not be saved at all until the field round-trips.

function cncProject(): Project {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' as const },
  };
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { ...base.scene, layers: [layer] },
  };
}

function loadWithProfileLead(profileLead: unknown): Project {
  const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
  const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
  const layer = scene.layers[0] as Record<string, unknown>;
  layer['cnc'] = { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside', profileLead };
  const result = deserializeProject(`${JSON.stringify(raw)}\n`);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project;
}

describe('.lf2 CNC profile lead round-trip (ADR-250)', () => {
  it('round-trips the explicit straight-plunge opt-out', () => {
    expect(loadWithProfileLead({ shape: 'none' }).scene.layers[0]?.cnc?.profileLead).toEqual({
      shape: 'none',
    });
  });

  it('round-trips a custom arc lead with radius and sweep', () => {
    expect(
      loadWithProfileLead({ shape: 'arc', radiusMm: 2.5, sweepDeg: 120 }).scene.layers[0]?.cnc
        ?.profileLead,
    ).toEqual({ shape: 'arc', radiusMm: 2.5, sweepDeg: 120 });
  });

  it('drops an unknown shape so the default-on arc applies by omission', () => {
    expect(
      loadWithProfileLead({ shape: 'spiral', radiusMm: 2 }).scene.layers[0]?.cnc?.profileLead,
    ).toBeUndefined();
  });

  it('drops a malformed radius while keeping the valid shape', () => {
    expect(
      loadWithProfileLead({ shape: 'line', radiusMm: -1 }).scene.layers[0]?.cnc?.profileLead,
    ).toEqual({ shape: 'line' });
  });
});
