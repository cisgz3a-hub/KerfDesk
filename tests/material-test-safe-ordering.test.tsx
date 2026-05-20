/**
 * F45-09-002: Material/G-code test execution should start with the lowest-risk cell.
 *
 * Run: npx tsx tests/material-test-safe-ordering.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import { generateTestGrid, type TestGridOptions } from '../src/core/tools/TestGridGenerator';
import { computeMaterialTestLayout, MaterialTestDialog } from '../src/ui/components/MaterialTestDialog';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: win.localStorage, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
if (typeof (win.HTMLElement.prototype as { attachEvent?: unknown }).attachEvent !== 'function') {
  (win.HTMLElement.prototype as unknown as { attachEvent: () => void }).attachEvent = () => undefined;
}
if (typeof (win.HTMLElement.prototype as { detachEvent?: unknown }).detachEvent !== 'function') {
  (win.HTMLElement.prototype as unknown as { detachEvent: () => void }).detachEvent = () => undefined;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function firstCellComment(gcode: string): string {
  return gcode.split('\n').find(line => line.startsWith('; Cell power=')) ?? '';
}

function firstCellRapid(gcode: string): string {
  const lines = gcode.split('\n');
  const firstCell = lines.findIndex(line => line.startsWith('; Cell power='));
  return lines.slice(firstCell + 1).find(line => line.startsWith('G0 X')) ?? '';
}

function firstPoweredLine(gcode: string): string {
  const lines = gcode.split('\n');
  const firstCell = lines.findIndex(line => line.startsWith('; Cell power='));
  return lines.slice(firstCell + 1).find(line => line.startsWith('G1 X')) ?? '';
}

async function generateMaterialTestObjects(): Promise<SceneObject[]> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  let generated: SceneObject[] = [];
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MaterialTestDialog, {
      scene: createScene(300, 300, 'material test ordering'),
      onApply: objects => { generated = objects; },
      onClose: () => undefined,
    }));
  });
  const generate = [...container.querySelectorAll('button')]
    .find(button => button.textContent?.startsWith('Generate ')) as HTMLButtonElement | undefined;
  assert(generate != null, 'material test generate button exists');
  await act(async () => { generate?.click(); });
  await act(async () => { root.unmount(); });
  return generated;
}

async function run(): Promise<void> {
  console.log('\n=== F45-09-002 material/G-code test safe ordering ===\n');

  {
    const opts: TestGridOptions = {
      cellSizeMm: 10,
      cellGapMm: 2,
      powers: [100, 500],
      speeds: [500, 2000],
      maxSpindle: 1000,
      originX: 0,
      originY: 0,
      lineIntervalMm: 5,
      travelSpeedMmPerMin: 6000,
      includeLabels: false,
      passes: 1,
    };
    const gcode = generateTestGrid(opts);
    assert(firstCellComment(gcode) === '; Cell power=100 speed=2000', 'G-code Test burns lowest power and highest speed first');
    assert(firstCellRapid(gcode).startsWith('G0 X12.000'), 'G-code Test first executed cell keeps the highest-speed visual column');
    assert(firstPoweredLine(gcode).includes('F2000 S100'), 'G-code Test first powered line uses highest speed and lowest power');
  }

  {
    const scene = createScene(300, 300, 'material test ordering');
    const layout = computeMaterialTestLayout(scene, { rows: 5, cols: 5, squareSize: 10, gap: 3 });
    const objects = await generateMaterialTestObjects();
    const firstSquare = objects.find(obj => obj.name.startsWith('Test P'));
    const firstLabel = objects.find(obj => obj.name.startsWith('Label P'));
    assert(firstSquare?.name === 'Test P20 S2000', 'Material Test creates the lowest-power highest-speed square first');
    assert(firstSquare?.transform.tx === layout.gridStartX + 4 * (10 + 3), 'Material Test first executed square remains in the highest-speed visual column');
    assert(
      firstLabel?.geometry.type === 'text'
      && firstLabel.geometry.text === '20%\n2000'
      && firstLabel.transform.tx === firstSquare?.transform.tx,
      'Material Test first label still maps to the first executed cell values and position',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
