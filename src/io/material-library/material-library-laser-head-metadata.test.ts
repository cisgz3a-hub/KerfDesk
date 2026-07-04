import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import type { MaterialRecipe } from '../../core/material-library';
import {
  createMaterialLibraryDeviceHint,
  deserializeMaterialLibrary,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
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
  tabsEnabled: false,
  tabSizeMm: 0.5,
  tabsPerShape: 4,
  tabSkipInnerShapes: true,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 5,
  fillStyle: 'scanline',
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'threshold',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
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

function library(entries: ReadonlyArray<MaterialPreset>): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'library-main',
    name: 'Shop Library',
    entries,
  };
}

describe('material library laser-head metadata', () => {
  it('roundtrips profile and laser-head matching metadata on presets', () => {
    const original = library([
      preset({
        profileId: 'neotronics-4040-max-lt4lds-v2-20w',
        machineFamily: 'neotronics-4040-max',
        laserModel: 'LASER TREE LT-4LDS-V2',
        laserTechnology: 'diode',
        opticalPowerW: 20,
        wavelengthNm: 455,
        material: 'Birch plywood',
        operation: 'engrave',
        confidence: 'calibrated',
        warning: 'Calibrated on 3 mm scrap only.',
        calibrationProvenance: 'Interval test 2026-06-17',
      }),
    ]);

    const result = deserializeMaterialLibrary(serializeMaterialLibrary(original));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.library.entries[0]).toMatchObject({
      profileId: 'neotronics-4040-max-lt4lds-v2-20w',
      machineFamily: 'neotronics-4040-max',
      laserModel: 'LASER TREE LT-4LDS-V2',
      laserTechnology: 'diode',
      opticalPowerW: 20,
      wavelengthNm: 455,
      material: 'Birch plywood',
      operation: 'engrave',
      confidence: 'calibrated',
      warning: 'Calibrated on 3 mm scrap only.',
      calibrationProvenance: 'Interval test 2026-06-17',
    });
  });

  it('rejects invalid laser-head preset metadata', () => {
    const result = deserializeMaterialLibrary(
      JSON.stringify({
        format: MATERIAL_LIBRARY_FORMAT,
        librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
        libraryId: 'library-main',
        name: 'Shop Library',
        entries: [
          {
            ...preset(),
            laserTechnology: 'plasma',
            wavelengthNm: -455,
          },
        ],
      }),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/laserTechnology|wavelengthNm/);
    }
  });

  it('captures laser-head metadata on device hints', () => {
    expect(createMaterialLibraryDeviceHint(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)).toMatchObject({
      name: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.name,
      laserSubProfile: {
        model: 'LASER TREE LT-4LDS-V2',
        technology: 'diode',
        metadataConfidence: 'researched',
        opticalPowerW: 20,
        wavelengthNm: 455,
      },
    });
  });
});
