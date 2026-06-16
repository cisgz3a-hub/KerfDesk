import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { MaterialRecipe } from '../../core/material-library';
import {
  createMaterialLibraryDeviceHint,
  deserializeMaterialLibrary,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  mergeMaterialLibraries,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from './material-library-io';

const lineRecipe: MaterialRecipe = {
  mode: 'line',
  minPower: 0,
  power: 35,
  speed: 1400,
  passes: 1,
  airAssist: false,
  kerfOffsetMm: 0,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 5,
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'threshold',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
};

const fillRecipe: MaterialRecipe = {
  ...lineRecipe,
  mode: 'fill',
  power: 42,
  speed: 1800,
  hatchAngleDeg: 45,
  hatchSpacingMm: 0.08,
  fillCrossHatch: true,
};

function preset(patch: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'preset-line-birch-3mm',
    materialName: 'Birch Ply',
    thicknessMm: 3,
    description: 'Line cut',
    recipe: lineRecipe,
    revision: 'rev-1',
    ...patch,
  };
}

function noThicknessPreset(patch: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'preset-score-no-thickness',
    materialName: 'Birch Ply',
    title: 'Score',
    description: 'Surface score',
    recipe: fillRecipe,
    revision: 'rev-1',
    ...patch,
  };
}

function library(patch: Partial<MaterialLibraryDocument> = {}): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'library-main',
    name: 'Shop Library',
    entries: [preset()],
    ...patch,
  };
}

describe('material library IO', () => {
  it('serializes deterministic .lfml.json with two-space LF JSON and trailing newline', () => {
    const doc = library();
    const text = serializeMaterialLibrary(doc);

    expect(text).toBe(serializeMaterialLibrary(doc));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "format"');
    expect(text).not.toContain('\r');
    expect(JSON.parse(text)).toEqual(doc);
  });

  it('roundtrips a valid library document', () => {
    const original = library({
      deviceHint: createMaterialLibraryDeviceHint({
        ...DEFAULT_DEVICE_PROFILE,
        name: 'Falcon 400',
      }),
      entries: [
        preset(),
        preset({
          id: 'preset-fill-acrylic-score',
          materialName: 'Acrylic',
          description: 'Fine surface score',
          recipe: fillRecipe,
        }),
        noThicknessPreset({ id: 'preset-no-thickness-score' }),
      ],
    });

    const result = deserializeMaterialLibrary(serializeMaterialLibrary(original));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.library).toEqual(original);
    }
  });

  it('reports structured parse and root-shape errors', () => {
    expect(deserializeMaterialLibrary('{not-json').kind).toBe('invalid');
    expect(deserializeMaterialLibrary('42').kind).toBe('invalid');
    expect(deserializeMaterialLibrary('[]').kind).toBe('invalid');
  });

  it('reports invalid for wrong format and schema version mismatches', () => {
    expect(deserializeMaterialLibrary(JSON.stringify({ ...library(), format: 'clb' })).kind).toBe(
      'invalid',
    );

    const tooNew = deserializeMaterialLibrary(
      JSON.stringify({
        ...library(),
        librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION + 1,
      }),
    );
    expect(tooNew.kind).toBe('schema-too-new');
    if (tooNew.kind === 'schema-too-new') {
      expect(tooNew.sawVersion).toBe(MATERIAL_LIBRARY_SCHEMA_VERSION + 1);
    }

    expect(
      deserializeMaterialLibrary(JSON.stringify({ ...library(), librarySchemaVersion: 0 })).kind,
    ).toBe('schema-too-old');
  });

  it('rejects invalid preset metadata and invalid recipes', () => {
    const { thicknessMm: _thicknessMm, title: _title, ...missingTitle } = preset();
    const missingNoThicknessTitle = { ...library(), entries: [missingTitle] };
    const badRecipe = library({
      entries: [preset({ recipe: { ...lineRecipe, power: 101 } })],
    });

    const metadataResult = deserializeMaterialLibrary(JSON.stringify(missingNoThicknessTitle));
    const recipeResult = deserializeMaterialLibrary(JSON.stringify(badRecipe));

    expect(metadataResult.kind).toBe('invalid');
    expect(recipeResult.kind).toBe('invalid');
    if (metadataResult.kind === 'invalid') {
      expect(metadataResult.reason).toMatch(/title/);
    }
    if (recipeResult.kind === 'invalid') {
      expect(recipeResult.reason).toMatch(/recipe/);
    }
  });

  it('rejects duplicate preset ids', () => {
    const result = deserializeMaterialLibrary(
      JSON.stringify({
        ...library(),
        entries: [preset({ id: 'dup' }), preset({ id: 'dup', description: 'Second' })],
      }),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/duplicate preset id/i);
    }
  });

  it('captures safety-relevant device hint fields from a device profile', () => {
    expect(createMaterialLibraryDeviceHint(DEFAULT_DEVICE_PROFILE)).toEqual({
      name: DEFAULT_DEVICE_PROFILE.name,
      bedWidth: DEFAULT_DEVICE_PROFILE.bedWidth,
      bedHeight: DEFAULT_DEVICE_PROFILE.bedHeight,
      maxFeed: DEFAULT_DEVICE_PROFILE.maxFeed,
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
      airAssistCommand: DEFAULT_DEVICE_PROFILE.airAssistCommand,
      origin: DEFAULT_DEVICE_PROFILE.origin,
    });
  });

  it('accepts older device hints without air assist and defaults them to disabled', () => {
    const deviceHint = createMaterialLibraryDeviceHint(DEFAULT_DEVICE_PROFILE);
    const { airAssistCommand: _airAssistCommand, ...legacyDeviceHint } = deviceHint;
    const result = deserializeMaterialLibrary(
      JSON.stringify({
        ...library(),
        deviceHint: legacyDeviceHint,
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.library.deviceHint).toEqual({
        ...deviceHint,
        airAssistCommand: 'none',
      });
    }
  });

  it('rejects invalid air assist command hints', () => {
    const result = deserializeMaterialLibrary(
      JSON.stringify({
        ...library(),
        deviceHint: {
          ...createMaterialLibraryDeviceHint(DEFAULT_DEVICE_PROFILE),
          airAssistCommand: 'M106',
        },
      }),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/deviceHint/);
    }
  });

  it('merges unique incoming presets and reports skipped duplicate ids', () => {
    const base = library({
      name: 'Base Library',
      entries: [preset({ id: 'keep-base', description: 'Base cut' })],
    });
    const incoming = library({
      libraryId: 'incoming-library',
      name: 'Incoming Library',
      entries: [
        preset({ id: 'keep-base', description: 'Incoming duplicate' }),
        preset({
          id: 'add-fill',
          materialName: 'Birch Ply',
          thicknessMm: 3,
          description: 'Fill engrave',
          recipe: fillRecipe,
        }),
      ],
    });

    const result = mergeMaterialLibraries(base, incoming);

    expect(result.skippedDuplicateIds).toEqual(['keep-base']);
    expect(result.library).toEqual({
      ...base,
      entries: [base.entries[0], incoming.entries[1]],
    });
  });
});
