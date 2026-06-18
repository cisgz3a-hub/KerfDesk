import { describe, expect, it } from 'vitest';
import { generateIntervalTestGrid, generateMaterialTestGrid } from '../../core/job';
import { createProject, type Project } from '../../core/scene';
import { materialLibraryCalibrationFromSelection } from './material-library-calibration';

function projectWithGrid(scene: Project['scene']): Project {
  return { ...createProject(), scene };
}

describe('material library calibration selection', () => {
  it('detects a selected material test swatch and captures effective power', () => {
    const grid = generateMaterialTestGrid({
      rows: 1,
      columns: 2,
      speedMin: 1000,
      speedMax: 2000,
      powerMin: 10,
      powerMax: 40,
      cellWidthMm: 5,
      cellHeightMm: 5,
    });
    const context = materialLibraryCalibrationFromSelection({
      project: projectWithGrid(grid.scene),
      selectedObjectId: 'material-test-cell-r0-c0',
    });

    expect(context).toMatchObject({
      kind: 'material-test',
      objectId: 'material-test-cell-r0-c0',
      layer: expect.objectContaining({ id: 'material-test-row-0' }),
      recipe: expect.objectContaining({ speed: 2000, power: 10, minPower: 0 }),
      operation: 'material-test',
      calibrationProvenance: 'Material Test swatch material-test-cell-r0-c0',
      note: 'Calibrated from Material Test swatch material-test-cell-r0-c0.',
    });
  });

  it('detects a selected interval test swatch and captures the hatch interval', () => {
    const grid = generateIntervalTestGrid({
      steps: 2,
      speed: 1500,
      power: 30,
      intervalMinMm: 0.08,
      intervalMaxMm: 0.2,
      swatchSizeMm: 8,
    });
    const context = materialLibraryCalibrationFromSelection({
      project: projectWithGrid(grid.scene),
      selectedObjectId: 'interval-test-cell-1',
    });

    expect(context).toMatchObject({
      kind: 'interval-test',
      objectId: 'interval-test-cell-1',
      layer: expect.objectContaining({ id: 'interval-test-step-1' }),
      recipe: expect.objectContaining({
        mode: 'fill',
        speed: 1500,
        power: 30,
        hatchSpacingMm: 0.08,
      }),
      operation: 'interval-test',
      calibrationProvenance: 'Interval Test swatch interval-test-cell-1',
      note: 'Calibrated from Interval Test swatch interval-test-cell-1.',
    });
  });

  it('ignores non-calibration selections', () => {
    const project = createProject();

    expect(
      materialLibraryCalibrationFromSelection({ project, selectedObjectId: null }),
    ).toBeNull();
    expect(
      materialLibraryCalibrationFromSelection({ project, selectedObjectId: 'missing' }),
    ).toBeNull();
  });
});
