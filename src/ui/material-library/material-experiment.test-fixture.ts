import { generateMaterialTestGrid } from '../../core/job';
import { createProject } from '../../core/scene';
import { captureGridExperiment } from './capture-material-experiment';

export function testExperiment() {
  const grid = generateMaterialTestGrid({
    rows: 2,
    columns: 2,
    speedMin: 1000,
    speedMax: 5000,
    powerMin: 10,
    powerMax: 40,
    maxFeedMmPerMin: 3000,
    cellWidthMm: 5,
    cellHeightMm: 4,
    gapMm: 2,
  });
  return captureGridExperiment(createProject(), grid, 'test', '2026-10-07T00:00:00.000Z');
}
