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

describe('.lf2 machine tools validation (audit 2026-07-17-0550 P2-1)', () => {
  // Inject the tools array as RAW JSON TEXT: writing `1e999` in a TS literal
  // is already Infinity, which JSON.stringify would flatten to null and skip
  // the very parse path under test. JSON.parse('1e999') === Infinity is the
  // real attack surface a hand-edited/corrupt .lf2 exercises.
  function loadWithToolsJson(toolsJson: string): Project {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    (raw['machine'] as Record<string, unknown>)['tools'] = '__TOOLS__';
    const text = JSON.stringify(raw).replace('"__TOOLS__"', toolsJson);
    return deserializeOk(`${text}\n`);
  }

  function firstTool(project: Project) {
    return project.machine?.kind === 'cnc' ? project.machine.tools[0] : undefined;
  }

  it('drops a tool whose diameter is non-finite (JSON 1e999 parses to Infinity)', () => {
    const project = loadWithToolsJson(
      '[{"id":"t-inf","name":"Broken","kind":"end-mill","diameterMm":1e999}]',
    );
    const tools = project.machine?.kind === 'cnc' ? project.machine.tools : [];
    expect(tools.every((tool) => Number.isFinite(tool.diameterMm))).toBe(true);
    expect(tools.some((tool) => tool.id === 't-inf')).toBe(false);
  });

  it('keeps a valid tool while dropping an invalid sibling', () => {
    const project = loadWithToolsJson(
      '[{"id":"good","name":"Good","kind":"end-mill","diameterMm":3.175},' +
        '{"id":"bad","name":"Bad","kind":"end-mill","diameterMm":1e999}]',
    );
    const tools = project.machine?.kind === 'cnc' ? project.machine.tools : [];
    expect(tools.map((tool) => tool.id)).toEqual(['good']);
  });

  it('drops a malformed tipAngleDeg but keeps the tool', () => {
    const tool = firstTool(
      loadWithToolsJson(
        '[{"id":"vb","name":"V-bit","kind":"v-bit","diameterMm":6.35,"tipAngleDeg":1e999}]',
      ),
    );
    expect(tool?.id).toBe('vb');
    expect(tool?.tipAngleDeg).toBeUndefined();
  });

  it('keeps a valid tipAngleDeg', () => {
    const tool = firstTool(
      loadWithToolsJson(
        '[{"id":"vb45","name":"45 V-bit","kind":"v-bit","diameterMm":6.35,"tipAngleDeg":45}]',
      ),
    );
    expect(tool?.tipAngleDeg).toBe(45);
  });

  it('defaults an unknown tool kind to end-mill instead of trusting junk', () => {
    const tool = firstTool(
      loadWithToolsJson('[{"id":"odd","name":"Odd","kind":"laser-beam","diameterMm":3}]'),
    );
    expect(tool?.id).toBe('odd');
    expect(tool?.kind).toBe('end-mill');
  });

  it('strips unknown extra fields from a tool record', () => {
    const tool = firstTool(
      loadWithToolsJson('[{"id":"x","name":"X","kind":"end-mill","diameterMm":3,"rogue":"boo"}]'),
    );
    expect(tool).toEqual({ id: 'x', name: 'X', kind: 'end-mill', diameterMm: 3 });
  });
});

describe('.lf2 machine / cnc round-trip', () => {
  it('round-trips inlay-pair settings and drops malformed values', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<{ cnc: Record<string, unknown> }> };
    scene.layers[0]!.cnc['cutType'] = 'inlay-pair';
    scene.layers[0]!.cnc['inlayPocketDepthMm'] = 3;
    scene.layers[0]!.cnc['inlayAllowanceMm'] = 0.1;
    scene.layers[0]!.cnc['inlayPairSpacingMm'] = 10;
    expect(deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc).toMatchObject({
      cutType: 'inlay-pair',
      inlayPocketDepthMm: 3,
      inlayAllowanceMm: 0.1,
      inlayPairSpacingMm: 10,
    });

    scene.layers[0]!.cnc['inlayPocketDepthMm'] = -1;
    scene.layers[0]!.cnc['inlayAllowanceMm'] = -1;
    scene.layers[0]!.cnc['inlayPairSpacingMm'] = 0;
    const malformed = deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc;
    expect(malformed?.inlayPocketDepthMm).toBeUndefined();
    expect(malformed?.inlayAllowanceMm).toBeUndefined();
    expect(malformed?.inlayPairSpacingMm).toBeUndefined();
  });

  it('round-trips adaptive strategy and optimal load while dropping malformed load', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<{ cnc: Record<string, unknown> }> };
    scene.layers[0]!.cnc['pocketStrategy'] = 'adaptive';
    scene.layers[0]!.cnc['adaptiveOptimalLoadMm'] = 0.4;
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    expect(loaded.scene.layers[0]?.cnc).toMatchObject({
      pocketStrategy: 'adaptive',
      adaptiveOptimalLoadMm: 0.4,
    });

    scene.layers[0]!.cnc['adaptiveOptimalLoadMm'] = -1;
    expect(
      deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.adaptiveOptimalLoadMm,
    ).toBeUndefined();
  });

  it('round-trips the selected pocket roughing bit', () => {
    const project = cncProject();
    const layer = project.scene.layers[0];
    if (layer?.cnc === undefined) throw new Error('CNC layer missing');
    const withRougher: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: [
          {
            ...layer,
            cnc: { ...layer.cnc, toolId: 'em-1588', pocketRoughToolId: 'em-6350' },
          },
        ],
      },
    };
    expect(
      deserializeOk(serializeProject(withRougher)).scene.layers[0]?.cnc?.pocketRoughToolId,
    ).toBe('em-6350');
  });

  it('round-trips valid helical-entry settings and drops malformed values', () => {
    const project = cncProject();
    const layer = project.scene.layers[0];
    if (layer?.cnc === undefined) throw new Error('CNC layer missing');
    const withHelix: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: [
          {
            ...layer,
            cnc: {
              ...layer.cnc,
              helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
            },
          },
        ],
      },
    };
    expect(deserializeOk(serializeProject(withHelix)).scene.layers[0]?.cnc?.helixEntry).toEqual({
      minDiameterMm: 2,
      maxDiameterMm: 8,
      angleDeg: 3,
    });

    const raw = JSON.parse(serializeProject(withHelix)) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<{ cnc: Record<string, unknown> }> };
    scene.layers[0]!.cnc['helixEntry'] = {
      minDiameterMm: 12,
      maxDiameterMm: 4,
      angleDeg: 'steep',
    };
    expect(
      deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.helixEntry,
    ).toBeUndefined();
  });

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

  it('round-trips automatic feed provenance without inferring it for legacy settings', () => {
    const project = cncProject();
    const layer = project.scene.layers[0];
    if (layer?.cnc === undefined) throw new Error('CNC layer missing');
    const withProvenance: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: [
          {
            ...layer,
            cnc: {
              ...layer.cnc,
              toolId: 'em-3175',
              feedMmPerMin: 600,
              plungeMmPerMin: 120,
              depthPerPassMm: 0.75,
              feedSource: {
                kind: 'machine-starter',
                starterId: 'neotronics-4040-shallow-wood-mdf',
                revision: 1,
              },
            },
          },
        ],
      },
    };

    expect(
      deserializeOk(serializeProject(withProvenance)).scene.layers[0]?.cnc?.feedSource,
    ).toEqual({
      kind: 'machine-starter',
      starterId: 'neotronics-4040-shallow-wood-mdf',
      revision: 1,
    });
    expect(
      deserializeOk(serializeProject(project)).scene.layers[0]?.cnc?.feedSource,
    ).toBeUndefined();
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

  it('round-trips the line-art contour side and drops an unknown value (ADR-218)', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
    const layer = scene.layers[0] as Record<string, unknown>;
    layer['cnc'] = { ...DEFAULT_CNC_LAYER_SETTINGS, lineArtContours: 'outer' };
    expect(deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.lineArtContours).toBe(
      'outer',
    );

    layer['cnc'] = { ...DEFAULT_CNC_LAYER_SETTINGS, lineArtContours: 'middle' };
    expect(
      deserializeOk(`${JSON.stringify(raw)}\n`).scene.layers[0]?.cnc?.lineArtContours,
    ).toBeUndefined();
  });

  it('replaces a malformed layer cnc block with defaults and drops non-objects', () => {
    const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
    const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
    const layer = scene.layers[0] as Record<string, unknown>;
    layer['cnc'] = { cutType: 'zigzag', depthMm: 0, feedMmPerMin: 'quick' };
    const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
    // Optional-with-compile-default fields (ADR-218 lineArtContours) stay
    // absent after normalization — the compile fallback supplies 'inner'.
    const { lineArtContours: _lineArt, ...structuralDefaults } = DEFAULT_CNC_LAYER_SETTINGS;
    expect(loaded.scene.layers[0]?.cnc).toEqual(structuralDefaults);

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
