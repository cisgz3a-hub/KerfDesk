/**
 * F45-05-001: preset-advertised Box Studio features must appear in generated scene geometry.
 *
 * Run: npx tsx tests/box-preset-generated-features.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BoxStudioWorkspace } from '../src/ui/components/box-library/BoxStudioWorkspace';
import { createScene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: win.localStorage, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
Object.defineProperty(win.HTMLCanvasElement.prototype, 'getContext', {
  value: () => ({
    setTransform: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fillText: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
  }),
  configurable: true,
});

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

async function generatePreset(presetId: string): Promise<SceneObject[]> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  let createBox: (() => void) | null = null;
  let generated: SceneObject[] = [];
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(BoxStudioWorkspace, {
      scene: createScene(),
      onGenerate: objects => { generated = objects; },
      onRegisterCreate: handler => { createBox = handler; },
    }));
  });

  const card = container.querySelector(`[data-testid="box-preset-card-${presetId}"]`) as HTMLButtonElement | null;
  assert(card != null, `${presetId}: preset card exists`);
  await act(async () => { card?.click(); });
  const apply = container.querySelector('[data-testid="box-use-preset"]') as HTMLButtonElement | null;
  assert(apply != null, `${presetId}: apply button exists`);
  await act(async () => { apply?.click(); });
  assert(createBox != null, `${presetId}: create handler registered`);
  await act(async () => { createBox?.(); });
  await act(async () => { root.unmount(); });
  return generated;
}

function featureCount(objects: SceneObject[], pattern: RegExp): number {
  return objects.filter(obj => pattern.test(obj.name)).length;
}

function allFeaturePolygonsAreClosed(objects: SceneObject[], pattern: RegExp): boolean {
  return objects
    .filter(obj => pattern.test(obj.name))
    .every(obj => obj.type === 'polygon'
      && obj.geometry.type === 'polygon'
      && obj.geometry.closed === true
      && obj.geometry.points.length === 4);
}

async function run(): Promise<void> {
  console.log('\n=== F45-05-001 box preset generated features ===\n');

  {
    const objects = await generatePreset('ventilated-project-box');
    assert(featureCount(objects, /Vent Slot/) >= 4, 'ventilated preset generates vent slot cut geometry');
    assert(allFeaturePolygonsAreClosed(objects, /Vent Slot/), 'vent slot features are closed polygon cutouts');
  }

  {
    const objects = await generatePreset('workshop-bin');
    assert(featureCount(objects, /Handle Slot/) >= 2, 'handle-slot preset generates handle slot cut geometry');
    assert(allFeaturePolygonsAreClosed(objects, /Handle Slot/), 'handle slot features are closed polygon cutouts');
  }

  {
    const objects = await generatePreset('premium-gift-box');
    assert(featureCount(objects, /Lid Pull Slot/) >= 1, 'lift-off lid preset generates lid pull slot cut geometry');
    assert(allFeaturePolygonsAreClosed(objects, /Lid Pull Slot/), 'lid pull slot feature is a closed polygon cutout');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
