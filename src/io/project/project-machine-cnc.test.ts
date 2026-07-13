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

  it('rejects a non-finite (1e999 → Infinity) machine numeric at the .lf2 boundary', () => {
    // JSON.stringify cannot emit Infinity, so splice the literal 1e999 into the
    // serialized text — JSON.parse turns it into Infinity, which would otherwise
    // ride through normalization into emitted G-code as "G0 ZInfinity".
    const text = serializeProject(cncProject()).replace(
      /"safeZMm":\s*[0-9.eE+-]+/,
      '"safeZMm": 1e999',
    );
    expect(text).toContain('1e999'); // the splice actually landed
    const machine = deserializeOk(text).machine;
    expect(machine?.kind).toBe('cnc');
    if (machine?.kind === 'cnc') {
      expect(Number.isFinite(machine.params.safeZMm)).toBe(true);
      expect(machine.params.safeZMm).toBe(DEFAULT_CNC_MACHINE_CONFIG.params.safeZMm);
    }
  });

  it('round-trips a custom stock footprint (H.2)', () => {
    const project: Project = {
      ...cncProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        stock: { thicknessMm: 12, widthMm: 250, heightMm: 120, originOffset: { x: 25, y: 40 } },
      },
    };
    const loaded = deserializeOk(serializeProject(project));
    expect(loaded.machine).toEqual(project.machine);
  });

  it('rebuilds a malformed stock footprint from defaults (H.2)', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    raw['machine'] = {
      kind: 'cnc',
      stock: { thicknessMm: 6.35, widthMm: -10, heightMm: 'wide', originOffset: { x: 'a', y: 0 } },
    };
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(loaded.machine).toEqual(DEFAULT_CNC_MACHINE_CONFIG);
  });

  it('fills stock footprint defaults into a pre-H.2 CNC project', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    raw['machine'] = { kind: 'cnc', stock: { thicknessMm: 9 } };
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(loaded.machine).toEqual({
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 9 },
    });
  });

  it('round-trips the project stock material and drops an unknown one (ADR-112)', () => {
    const project: Project = {
      ...cncProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, materialKey: 'hardwood' },
      },
    };
    const loaded = deserializeOk(serializeProject(project));
    expect(loaded.machine?.kind === 'cnc' ? loaded.machine.stock.materialKey : null).toBe(
      'hardwood',
    );

    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    (raw['machine'] as { stock: Record<string, unknown> }).stock['materialKey'] = 'kryptonite';
    const dropped = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(
      dropped.machine?.kind === 'cnc' ? dropped.machine.stock.materialKey : 'sentinel',
    ).toBeUndefined();
  });

  it('round-trips a valid materialKey and drops an unknown one (ADR-111)', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
    const layer = scene.layers[0] as Record<string, unknown>;
    layer['cnc'] = { ...DEFAULT_CNC_LAYER_SETTINGS, materialKey: 'plywood-mdf' };
    expect(deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.materialKey).toBe(
      'plywood-mdf',
    );

    layer['cnc'] = { ...DEFAULT_CNC_LAYER_SETTINGS, materialKey: 'unobtainium' };
    expect(
      deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.materialKey,
    ).toBeUndefined();
  });

  it('round-trips a finish allowance and drops a negative one', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
    const layer = scene.layers[0] as Record<string, unknown>;
    layer['cnc'] = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside',
      finishAllowanceMm: 1.5,
    };
    expect(deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.finishAllowanceMm).toBe(
      1.5,
    );

    layer['cnc'] = { ...DEFAULT_CNC_LAYER_SETTINGS, finishAllowanceMm: -2 };
    expect(
      deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.finishAllowanceMm,
    ).toBeUndefined();
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

  it('round-trips a flood coolant setting', () => {
    const project: Project = {
      ...cncProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, coolant: 'flood' },
      },
    };
    const loaded = deserializeOk(serializeProject(project));
    expect(loaded.machine?.kind === 'cnc' ? loaded.machine.params.coolant : null).toBe('flood');
  });

  it('drops an unknown coolant value to off', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    (raw['machine'] as { params: Record<string, unknown> }).params['coolant'] = 'liquid-nitrogen';
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(loaded.machine?.kind === 'cnc' ? loaded.machine.params.coolant : null).toBe('off');
  });
});
