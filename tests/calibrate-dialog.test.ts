import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CalibrateMaterialDialog,
  buildCalibrationGridOptions,
  getStageLabel,
} from '../src/ui/components/materials/CalibrateMaterialDialog';
import { type CalibrationGridResult } from '../src/core/materials/CalibrationGrid';
import { createLayer } from '../src/core/scene/Layer';
import { createRect } from '../src/core/scene/SceneObject';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== Calibrate dialog: stage labels ===');

assert(getStageLabel('configure') === 'Configure', 'configure stage label');
assert(getStageLabel('burn') === 'Burn', 'burn stage label');
assert(getStageLabel('analyze') === 'Analyze', 'analyze stage label');

console.log('\n=== Calibrate dialog: mount and stage render ===');

const layer = createLayer(0, 'engrave', 'Calib 05%');
const result: CalibrationGridResult = {
  layers: [layer],
  objects: [createRect(layer.id, 10, 10, 10, 10)],
  squares: [{ index: 0, commandedPower: 5, bounds: { x: 10, y: 10, width: 10, height: 10 } }],
};

const configureHtml = renderToStaticMarkup(
  React.createElement(CalibrateMaterialDialog, {
    isOpen: true,
    onClose: () => {},
    onGridEmitted: () => {},
  }),
);
assert(configureHtml.includes('Calibrate Material'), 'dialog mounts without throwing');
assert(configureHtml.includes('Stage: Configure'), 'configure stage renders expected label');

const burnHtml = renderToStaticMarkup(
  React.createElement(CalibrateMaterialDialog, {
    isOpen: true,
    onClose: () => {},
    onGridEmitted: () => {},
    initialResult: result,
    initialStage: 'burn',
  }),
);
assert(burnHtml.includes('Stage: Burn'), 'burn stage renders expected label');

const analyzeHtml = renderToStaticMarkup(
  React.createElement(CalibrateMaterialDialog, {
    isOpen: true,
    onClose: () => {},
    onGridEmitted: () => {},
    initialResult: result,
    initialStage: 'analyze',
  }),
);
assert(analyzeHtml.includes('Stage: Analyze'), 'analyze stage renders expected label');

console.log('\n=== Calibrate dialog: emit payload shape ===');

const opts = buildCalibrationGridOptions({
  materialName: '  Birch Ply  ',
  scanSpeed: 3200,
  powerSteps: 11,
  powerMin: 12,
  powerMax: 87,
});
assert(opts.materialName === 'Birch Ply', 'build options trims material name');
assert(opts.scanSpeed === 3200, 'build options keeps scanSpeed');
assert(opts.powerSteps === 11, 'build options keeps powerSteps');
assert(opts.powerMin === 12 && opts.powerMax === 87, 'build options keeps power range');

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) throw new Error(`calibrate-dialog.test.ts: ${failed} assertion(s) failed`);
process.exit(0);
