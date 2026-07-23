import { describe, expect, it } from 'vitest';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type Layer,
} from '../../../core/scene';
import type { MaterialLibraryDocument } from '../../../io/material-library';
import {
  boundMaterialLabel,
  cncOperationDetail,
  laserOperationDetail,
} from './job-review-detail-facts';

const baseLayer = createLayer({ id: 'a', color: '#ff0000' });

describe('laserOperationDetail', () => {
  it('summarizes a line operation: kerf, tabs, min power', () => {
    expect(laserOperationDetail(baseLayer)).toBe('Kerf 0 mm · tabs off · min power 0%');
  });

  it('adds tabs, pass-through, and power mode when set on a line operation', () => {
    const layer: Layer = {
      ...baseLayer,
      kerfOffsetMm: 0.15,
      tabsEnabled: true,
      tabsPerShape: 3,
      tabSizeMm: 0.5,
      passThrough: true,
      powerMode: 'dynamic',
    };
    expect(laserOperationDetail(layer)).toBe(
      'Kerf 0.2 mm · tabs 3 × 0.5 mm · pass-through · min power 0% · dynamic power',
    );
  });

  it('summarizes a fill operation: style, hatch, direction, overscan', () => {
    const layer: Layer = { ...baseLayer, mode: 'fill', fillCrossHatch: true };
    expect(laserOperationDetail(layer)).toBe(
      'Scanline fill · 0.1 mm hatch at 0° · bidirectional · cross-hatch · overscan 5 mm',
    );
  });

  it('summarizes an image operation: dither, resolution, extras only when set', () => {
    const layer: Layer = {
      ...baseLayer,
      mode: 'image',
      negativeImage: true,
      dotWidthCorrectionMm: 0.1,
      imageBidirectional: false,
    };
    expect(laserOperationDetail(layer)).toBe(
      'Floyd-Steinberg dither · 10 lines/mm · one-way · negative · dot width 0.1 mm',
    );
  });
});

describe('cncOperationDetail', () => {
  it('summarizes the default profile cut with a computed pass count', () => {
    expect(cncOperationDetail(DEFAULT_CNC_LAYER_SETTINGS)).toBe(
      '1 pass · stepover 40% · climb · tabs off · Manual feeds',
    );
  });

  it('includes direction, tabs, entry, finish allowance, strategy, and material feeds', () => {
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      depthMm: 12,
      depthPerPassMm: 2.5,
      cutDirection: 'climb',
      tabsEnabled: true,
      tabsPerShape: 3,
      tabWidthMm: 6,
      tabHeightMm: 2,
      rampEntryDeg: 3,
      finishAllowanceMm: 0.5,
      pocketStrategy: 'raster-x',
      materialKey: 'plywood-mdf',
    };
    expect(cncOperationDetail(settings)).toBe(
      '5 passes · stepover 40% · climb · tabs 3 per shape (6 × 2 mm) · ramp entry 3° · finish allowance 0.5 mm · raster-x pocket · Plywood / MDF feeds (legacy/unscoped)',
    );
  });

  it('names a persisted machine starter and revision', () => {
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedSource: {
        kind: 'machine-starter',
        starterId: 'neotronics-4040-shallow-wood-mdf',
        revision: 1,
      },
    };
    expect(cncOperationDetail(settings)).toContain(
      'Machine starter values: Neotronics 4040 shallow wood / MDF starter (revision 1)',
    );
    expect(cncOperationDetail(settings)).toContain(
      'Engineering starter — assumes a 3.175 mm 2-flute cutter; verify on this machine.',
    );
  });

  it('shows the persisted id when a starter is no longer in the catalog', () => {
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedSource: { kind: 'machine-starter', starterId: 'retired-starter', revision: 3 },
    };
    expect(cncOperationDetail(settings)).toContain(
      'Machine starter values: retired-starter (revision 3; catalog entry unavailable)',
    );
  });
});

describe('boundMaterialLabel', () => {
  const library = {
    libraryId: 'lib-1',
    entries: [
      { id: 'p1', materialName: 'Basswood', thicknessMm: 3 },
      { id: 'p2', materialName: 'Acrylic', title: 'Cast acrylic — engrave' },
    ],
    // Only the fields the resolver reads matter for this test double.
  } as unknown as MaterialLibraryDocument;

  it('returns null when the layer has no binding', () => {
    expect(boundMaterialLabel(undefined, library)).toBeNull();
  });

  it('resolves material name plus thickness, preferring an explicit title', () => {
    const binding = { libraryId: 'lib-1', presetId: 'p1', lastResolved: baseLayer };
    expect(boundMaterialLabel(binding, library)).toBe('Basswood 3 mm');
    const titled = { libraryId: 'lib-1', presetId: 'p2', lastResolved: baseLayer };
    expect(boundMaterialLabel(titled, library)).toBe('Cast acrylic — engrave');
  });

  it('says so when the library or preset is unavailable', () => {
    const binding = { libraryId: 'other', presetId: 'p1', lastResolved: baseLayer };
    expect(boundMaterialLabel(binding, library)).toBe('Linked material (library unavailable)');
    const missing = { libraryId: 'lib-1', presetId: 'ghost', lastResolved: baseLayer };
    expect(boundMaterialLabel(missing, library)).toBe('Linked material (preset missing)');
  });
});
