import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CNC_CONTEXT_PRESET, CNC_CONTEXT_TOOL } from '../../__fixtures__/cnc-cutting-preset';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
import { type CncCuttingPreset } from '../../core/scene/cnc-cutting-preset';
import { cncCuttingPresetPatch, cncCuttingPresetDifferences } from '../../core/cnc/cutting-preset';
import { deserializeProject, serializeProject } from '../../io/project';
import { withManualCncFeedPatch } from './cnc-feed-provenance';
import { parseCncLibrary } from './cnc-library-persistence';
import { previewCncPresetImport } from './cnc-preset-transfer';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  resetStore();
  useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
});
afterEach(() => resetStore());

describe('contextual CNC cutting-data persistence', () => {
  it('retains assembly and cutting evidence in the existing app library slot', () => {
    const library = {
      customTools: [CNC_CONTEXT_TOOL],
      feedPresets: [CNC_CONTEXT_PRESET],
      machineProfiles: [
        {
          id: 'router-profile',
          name: 'Router',
          machine: {
            ...DEFAULT_CNC_MACHINE_CONFIG,
            tools: [CNC_CONTEXT_TOOL],
            toolId: CNC_CONTEXT_TOOL.id,
          },
        },
      ],
    };
    expect(parseCncLibrary(JSON.stringify(library))).toEqual(library);
  });
  it('preserves manual job overrides and the saved baseline after .lf2 reopening', () => {
    const applied = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      ...cncCuttingPresetPatch(CNC_CONTEXT_PRESET),
      materialKey: 'plywood-mdf',
    };
    const overridden = withManualCncFeedPatch(applied, { feedMmPerMin: 975, depthPerPassMm: 0.8 });
    const base = createProject();
    const project = {
      ...base,
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tools: [CNC_CONTEXT_TOOL],
        toolId: CNC_CONTEXT_TOOL.id,
      },
      scene: {
        ...base.scene,
        layers: [{ ...createLayer({ id: 'op', color: '#000000' }), cnc: overridden }],
      },
    };
    const restored = deserializeProject(serializeProject(project));
    expect(restored.kind).toBe('ok');
    if (restored.kind !== 'ok') throw new Error('Project restore failed');
    const cnc = restored.project.scene.layers[0]?.cnc;
    expect(cnc?.feedMmPerMin).toBe(975);
    expect(cnc?.depthPerPassMm).toBe(0.8);
    expect(cnc?.cuttingPreset).toEqual(CNC_CONTEXT_PRESET);
    expect(
      restored.project.machine?.kind === 'cnc' ? restored.project.machine.tools[0] : null,
    ).toEqual(CNC_CONTEXT_TOOL);
    if (cnc === undefined) throw new Error('CNC settings missing');
    expect(cncCuttingPresetDifferences(CNC_CONTEXT_PRESET, cnc).map((d) => d.key)).toEqual([
      'feedMmPerMin',
      'depthPerPassMm',
    ]);
  });
  it('previews import conflicts and preserves source notes without replacing entries', () => {
    const imported = {
      ...CNC_CONTEXT_PRESET,
      feedMmPerMin: 880,
      provenance: { kind: 'manufacturer' as const, reference: 'Supplied cutter data reference' },
      qualification: {
        status: 'operator-qualified' as const,
        notes: 'Operator trial evidence provided with imported file.',
      },
    };
    const preview = previewCncPresetImport(
      JSON.stringify({ schemaVersion: 1, units: 'mm-min-rpm', feedPresets: [imported] }),
      [CNC_CONTEXT_PRESET],
    );
    expect(preview.error).toBeNull();
    expect(preview.conflicts).toHaveLength(1);
    useStore.setState((s) => ({
      cncLibrary: { ...s.cncLibrary, feedPresets: [CNC_CONTEXT_PRESET] },
    }));
    useStore.getState().importCncFeedPresets(preview.presets);
    const [original, copy] = useStore.getState().cncLibrary.feedPresets;
    expect(original).toEqual(CNC_CONTEXT_PRESET);
    expect(copy?.id).not.toBe(CNC_CONTEXT_PRESET.id);
    expect(copy?.provenance).toEqual(imported.provenance);
    expect(copy?.qualification).toEqual(imported.qualification);
    expect(copy?.context).toEqual(imported.context);
    expect(copy?.feedMmPerMin).toBe(880);
  });
  it('discloses invalid imported records and rejects unsupported export units', () => {
    const preview = previewCncPresetImport(
      JSON.stringify([CNC_CONTEXT_PRESET, { ...CNC_CONTEXT_PRESET, depthPerPassMm: -1 }]),
      [],
    );
    expect(preview.presets).toHaveLength(1);
    expect(preview.discarded).toBe(1);
    expect(
      previewCncPresetImport(
        JSON.stringify({ units: 'inches', feedPresets: [CNC_CONTEXT_PRESET] }),
        [],
      ).error,
    ).toContain('Unsupported');
  });
  it('deleting a library entry cannot change the job baseline or numeric overrides', () => {
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      ...cncCuttingPresetPatch(CNC_CONTEXT_PRESET),
      feedMmPerMin: 945,
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [{ ...createLayer({ id: 'op', color: '#000000' }), cnc: settings }],
        },
      },
      cncLibrary: { ...state.cncLibrary, feedPresets: [CNC_CONTEXT_PRESET] },
    }));
    useStore.getState().deleteCncFeedPreset(CNC_CONTEXT_PRESET.id);
    expect(useStore.getState().cncLibrary.feedPresets).toHaveLength(0);
    expect(useStore.getState().project.scene.layers[0]?.cnc).toEqual(settings);
  });
  it('restores and imports unbound trial notes as unverified without inventing context', () => {
    const { context: _context, ...unbound } = CNC_CONTEXT_PRESET;
    const raw = {
      ...unbound,
      qualification: {
        status: 'operator-qualified' as const,
        notes: 'Notes supplied without the trial context.',
      },
    };
    const expected = {
      ...raw,
      qualification: { status: 'unverified', notes: raw.qualification.notes },
    };
    const restored = parseCncLibrary(JSON.stringify({ feedPresets: [raw] }));
    expect(restored?.feedPresets[0]).toEqual(expected);
    const preview = previewCncPresetImport(JSON.stringify([raw]), []);
    expect(preview.presets).toEqual([expected]);
    useStore.getState().importCncFeedPresets(preview.presets);
    const imported = useStore.getState().cncLibrary.feedPresets[0];
    expect(imported).toMatchObject({ ...expected, id: expect.any(String) });
    expect(imported).not.toHaveProperty('context');
    expect(imported?.id).not.toBe(raw.id);
    expect(previewCncPresetImport(JSON.stringify([{ ...raw, context: null }]), []).discarded).toBe(
      1,
    );
  });
  it('round-trips generic values and supporting notes through an operation snapshot', () => {
    const { context: _context, ...unbound } = CNC_CONTEXT_PRESET;
    const generic: CncCuttingPreset = {
      ...unbound,
      qualification: { status: 'unverified', notes: 'Manual starting values, no material trial.' },
    };
    const base = createProject();
    const project = {
      ...base,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...base.scene,
        layers: [
          {
            ...createLayer({ id: 'generic', color: '#000000' }),
            cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cncCuttingPresetPatch(generic) },
          },
        ],
      },
    };
    const restored = deserializeProject(serializeProject(project));
    expect(restored.kind).toBe('ok');
    if (restored.kind !== 'ok') throw new Error('Generic project restore failed');
    const settings = restored.project.scene.layers[0]?.cnc;
    expect(settings?.cuttingPreset).toEqual(generic);
    expect(settings?.cuttingPreset).not.toHaveProperty('context');
    expect(settings?.feedMmPerMin).toBe(generic.feedMmPerMin);
    expect(settings?.stepoverPercent).toBe(generic.stepoverPercent);
  });
  it('retains old numeric-only records without fabricating context or qualification', () => {
    const legacy: CncCuttingPreset = {
      id: 'legacy',
      name: 'Old feeds',
      feedMmPerMin: 777.7,
      plungeMmPerMin: 200,
      spindleRpm: 12000,
      depthPerPassMm: 0.35,
      stepoverPercent: 40,
    };
    expect(parseCncLibrary(JSON.stringify({ feedPresets: [legacy] }))?.feedPresets[0]).toEqual(
      legacy,
    );
  });
});
