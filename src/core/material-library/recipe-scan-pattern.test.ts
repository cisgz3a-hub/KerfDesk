// ADR-093 Amendment 2 (Oracle audit O9-P2-1): a preset carries the scan
// pattern, so applying it scans as the operation it was saved from did.
import { describe, expect, it } from 'vitest';
import { imageScanPassRuns } from '../job/scan-pass-angles';
import { createLayer, type Layer } from '../scene';
import {
  applyMaterialRecipe,
  captureMaterialRecipe,
  isMaterialRecipe,
  normalizeMaterialRecipe,
} from './material-library';

const plainImage: Layer = {
  ...createLayer({ id: 'source', color: '#000000' }),
  mode: 'image',
  power: 40,
  speed: 6000,
};

describe('material presets carry the scan pattern (ADR-093 Amendment 2)', () => {
  it('turns off a cross-hatch, scan angle and angle step the preset does not hold', () => {
    const preset = captureMaterialRecipe(plainImage);
    const target: Layer = {
      ...createLayer({ id: 'target', color: '#ff0000' }),
      mode: 'image',
      passes: 2,
      imageCrossHatch: true,
      imageScanAngleDeg: 45,
      passAngleStepDeg: 30,
    };
    const applied = applyMaterialRecipe(target, preset);
    // One scan along X per pass, as on the operation the preset was saved
    // from; before, every pass scanned twice, at 45 and 135 degrees.
    expect(imageScanPassRuns(applied)).toEqual(imageScanPassRuns(plainImage));
    expect(applied.imageCrossHatch).toBeUndefined();
    expect(applied.imageScanAngleDeg).toBeUndefined();
    expect(applied.passAngleStepDeg).toBeUndefined();
  });

  it('keeps the cross-hatch, angles and fill ramp of the operation it was saved from', () => {
    const crossed: Layer = {
      ...plainImage,
      passes: 2,
      imageCrossHatch: true,
      imageScanAngleDeg: 30,
      passAngleStepDeg: 15,
    };
    const reapplied = applyMaterialRecipe(
      createLayer({ id: 'fresh', color: '#00ff00' }),
      captureMaterialRecipe(crossed),
    );
    expect(imageScanPassRuns(reapplied)).toEqual(imageScanPassRuns(crossed));

    const ramped: Layer = {
      ...createLayer({ id: 'stamp', color: '#0000ff' }),
      mode: 'fill',
      fillRampLengthMm: 1.5,
      fillRampOuterEdge: true,
    };
    const stamp = applyMaterialRecipe(
      createLayer({ id: 'fresh', color: '#00ff00' }),
      captureMaterialRecipe(ramped),
    );
    expect(stamp.fillRampLengthMm).toBe(1.5);
    expect(stamp.fillRampOuterEdge).toBe(true);
    expect(applyMaterialRecipe(ramped, captureMaterialRecipe(plainImage)).fillRampLengthMm).toBe(
      undefined,
    );
  });

  it('holds each setting only while it is on', () => {
    const off = captureMaterialRecipe({
      ...plainImage,
      imageCrossHatch: false,
      imageScanAngleDeg: 180,
      passAngleStepDeg: 0,
      fillRampLengthMm: 0,
      fillRampOuterEdge: true,
    });
    for (const key of [
      'imageCrossHatch',
      'imageScanAngleDeg',
      'passAngleStepDeg',
      'fillRampLengthMm',
      'fillRampOuterEdge',
    ]) {
      expect(key in off, key).toBe(false);
    }
    expect(captureMaterialRecipe({ ...plainImage, imageScanAngleDeg: -30 }).imageScanAngleDeg).toBe(
      150,
    );
  });

  it('validates the stored fields and keeps them through normalisation', () => {
    const recipe = captureMaterialRecipe({ ...plainImage, imageCrossHatch: true });
    expect(isMaterialRecipe(recipe)).toBe(true);
    expect(normalizeMaterialRecipe(recipe).imageCrossHatch).toBe(true);
    expect(isMaterialRecipe({ ...recipe, imageCrossHatch: 'yes' })).toBe(false);
    expect(isMaterialRecipe({ ...recipe, fillRampLengthMm: -1 })).toBe(false);
    expect(isMaterialRecipe({ ...recipe, imageScanAngleDeg: Number.NaN })).toBe(false);
  });
});
