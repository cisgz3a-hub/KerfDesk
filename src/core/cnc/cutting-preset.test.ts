import { describe, expect, it } from 'vitest';
import { CNC_CONTEXT_PRESET } from '../../__fixtures__/cnc-cutting-preset';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../scene';
import { cncCuttingPresetPatch, previewCncCuttingPreset } from './cutting-preset';
import { normalizeCncCuttingPreset } from './cutting-preset-normalize';

const CONTEXT = CNC_CONTEXT_PRESET.context;
if (CONTEXT === undefined) throw new Error('Context fixture missing');

describe('contextual cutting record application', () => {
  it('compares numeric changes without mutating job settings', () => {
    const settings = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 1000 };
    const preview = previewCncCuttingPreset(CNC_CONTEXT_PRESET, settings, CONTEXT);
    expect(preview.compatible).toBe(true);
    expect(preview.differences).toContainEqual({ key: 'feedMmPerMin', current: 1000, saved: 800 });
    expect(settings.feedMmPerMin).toBe(1000);
    expect(preview.evidenceFindings.join(' ')).toContain('No operator material-cut qualification');
  });
  it('flags a 3 mm plywood record against a 6 mm metal/machine context', () => {
    const preview = previewCncCuttingPreset(CNC_CONTEXT_PRESET, CNC_CONTEXT_PRESET, {
      ...CONTEXT,
      materialKey: 'aluminium',
      tool: { ...CONTEXT.tool, diameterMm: 6 },
      machine: { ...CONTEXT.machine, profileId: 'mill-b', name: 'Metal mill' },
    });
    expect(preview.compatible).toBe(false);
    expect(preview.contextFindings).toHaveLength(3);
    expect(preview.contextFindings.join(' ')).toContain('6 mm');
    expect(preview.contextFindings.join(' ')).toContain('aluminium');
  });
  it.each(['diameterMm', 'kind', 'tipAngleDeg', 'tipDiameterMm', 'family', 'fluteCount'] as const)(
    'does not treat a changed %s as a compatible cutter',
    (field) => {
      const patch = {
        diameterMm: 4,
        kind: 'ball-nose',
        tipAngleDeg: 45,
        tipDiameterMm: 0.2,
        family: 'upcut',
        fluteCount: 3,
      };
      const current = { ...CONTEXT, tool: { ...CONTEXT.tool, [field]: patch[field] } };
      expect(
        previewCncCuttingPreset(CNC_CONTEXT_PRESET, CNC_CONTEXT_PRESET, current).compatible,
      ).toBe(false);
    },
  );
  it('recognizes equivalent geometry with a new local tool id without changing assignments', () => {
    const current = { ...CONTEXT, tool: { ...CONTEXT.tool, id: 'another-id', name: 'Alias' } };
    expect(
      previewCncCuttingPreset(CNC_CONTEXT_PRESET, CNC_CONTEXT_PRESET, current).compatible,
    ).toBe(true);
    const patch = cncCuttingPresetPatch(CNC_CONTEXT_PRESET);
    expect(patch.cuttingPreset).toEqual(CNC_CONTEXT_PRESET);
    expect(patch).not.toHaveProperty('toolId');
    expect(patch).not.toHaveProperty('materialKey');
    expect(patch).not.toHaveProperty('depthMm');
  });
  it('discloses legacy bindings and absent evidence', () => {
    const legacy = {
      id: 'old',
      name: 'Old preset',
      feedMmPerMin: 100,
      plungeMmPerMin: 50,
      spindleRpm: 10000,
      depthPerPassMm: 0.5,
      stepoverPercent: 40,
    };
    const restored = normalizeCncCuttingPreset(legacy);
    expect(restored).toEqual(legacy);
    const preview = previewCncCuttingPreset(legacy, legacy, CONTEXT);
    expect(preview.compatible).toBe(false);
    expect(preview.evidenceFindings).toHaveLength(2);
    expect(preview.contextFindings[0]).toContain('unbound');
  });
});

describe('cutting record normalization', () => {
  it('round-trips fractional millimetre values and evidence independently of display units', () => {
    expect(normalizeCncCuttingPreset(JSON.parse(JSON.stringify(CNC_CONTEXT_PRESET)))).toEqual(
      CNC_CONTEXT_PRESET,
    );
  });
  it.each([
    { units: 'inch' },
    { context: { materialKey: 'plywood-mdf' } },
    { feedMmPerMin: Infinity },
    { depthPerPassMm: -0.1 },
    { stepoverPercent: 101 },
  ])('rejects unsupported units or malformed bound data without silently unbinding', (patch) => {
    expect(normalizeCncCuttingPreset({ ...CNC_CONTEXT_PRESET, ...patch })).toBeNull();
  });
  it('downgrades absent-context qualification while preserving its notes and provenance', () => {
    const { context: _context, ...unbound } = CNC_CONTEXT_PRESET;
    const raw = {
      ...unbound,
      qualification: { status: 'operator-qualified' as const, notes: 'Supplied trial notes.' },
    };
    expect(normalizeCncCuttingPreset(raw)).toEqual({
      ...raw,
      qualification: { status: 'unverified', notes: raw.qualification.notes },
    });
  });
  it('preserves a qualified bound record and rejects supplied malformed context', () => {
    const qualified = {
      ...CNC_CONTEXT_PRESET,
      qualification: {
        status: 'operator-qualified' as const,
        notes: 'Trial for these exact values.',
      },
    };
    expect(normalizeCncCuttingPreset(qualified)).toEqual(qualified);
    expect(normalizeCncCuttingPreset({ ...qualified, context: null })).toBeNull();
    expect(
      normalizeCncCuttingPreset({ ...qualified, context: { materialKey: 'plywood-mdf' } }),
    ).toBeNull();
  });
  it('withdraws malformed optional evidence without claiming a qualified source', () => {
    const parsed = normalizeCncCuttingPreset({
      ...CNC_CONTEXT_PRESET,
      provenance: { kind: 'unknown', reference: 'x' },
      qualification: { status: 'passed' },
    });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('provenance');
    expect(parsed).not.toHaveProperty('qualification');
  });
});
