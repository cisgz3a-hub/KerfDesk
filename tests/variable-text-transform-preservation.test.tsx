/**
 * F45-07-003: Variable Text copies must preserve source transform rotation/shear.
 *
 * Run: npx tsx tests/variable-text-transform-preservation.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type SceneObject } from '../src/core/scene/SceneObject';
import { VariableTextDialog } from '../src/ui/components/VariableTextDialog';
import { type TextOperationMode } from '../src/ui/scene/TextOperationLayer';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function approx(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 1e-9, `${message} (got ${actual}, expected ${expected})`);
}

function makeSourceObject(layerId: string): SceneObject {
  return {
    id: 'source-text',
    type: 'text',
    name: 'Rotated template',
    layerId,
    parentId: null,
    transform: { a: 0, b: 1, c: -1, d: 0, tx: 5, ty: 6 },
    geometry: {
      type: 'text',
      text: 'Tag {n}',
      fontSize: 10,
      fontFamily: 'Inter',
      bold: false,
      italic: false,
    },
    visible: true,
    locked: false,
    powerScale: 1,
    cutStartIndex: 0,
    _bounds: null,
    _worldTransform: null,
  };
}

async function renderDialog(): Promise<{
  root: Root;
  container: HTMLElement;
  generated: () => readonly SceneObject[];
  operationMode: () => TextOperationMode | null;
}> {
  const container = win.document.getElementById('root') as HTMLElement;
  container.innerHTML = '';
  const root = createRoot(container);
  const layer = createLayer(0, 'engrave', 'Engrave');
  const sourceObject = makeSourceObject(layer.id);
  const scene = {
    ...createScene(300, 200, 'Variable Text Test'),
    layers: [layer],
    activeLayerId: layer.id,
    objects: [sourceObject],
  };
  let generatedObjects: readonly SceneObject[] = [];
  let selectedOperation: TextOperationMode | null = null;

  await act(async () => {
    root.render(React.createElement(VariableTextDialog, {
      scene,
      sourceObject,
      onGenerate: (objects, mode) => {
        generatedObjects = objects;
        selectedOperation = mode;
      },
      onClose: () => undefined,
    }));
  });

  return {
    root,
    container,
    generated: () => generatedObjects,
    operationMode: () => selectedOperation,
  };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

console.log('\n=== F45-07-003 Variable Text transform preservation ===\n');

async function run(): Promise<void> {
  const harness = await renderDialog();
  const generate = Array.from(harness.container.querySelectorAll('button'))
    .find(button => button.textContent?.includes('Generate 10 Numbered Copies')) as HTMLButtonElement | undefined;
  assert(generate != null, 'generate button renders');

  await act(async () => {
    generate?.click();
  });

  const objects = harness.generated();
  assert(objects.length === 10, 'default variable text generation creates 10 objects');
  assert(harness.operationMode() === 'engrave', 'operation mode still follows the source layer');

  const first = objects[0]?.transform;
  approx(first.a, 0, 'first copy preserves source a');
  approx(first.b, 1, 'first copy preserves source b');
  approx(first.c, -1, 'first copy preserves source c');
  approx(first.d, 0, 'first copy preserves source d');
  approx(first.tx, 5, 'first copy keeps source tx');
  approx(first.ty, 6, 'first copy keeps source ty');

  const second = objects[1]?.transform;
  const itemWidth = 10 * Math.max('Tag 1'.length, 'Tag 10'.length, 3) * 0.6 + 10;
  approx(second.a, 0, 'second copy preserves source a');
  approx(second.b, 1, 'second copy preserves source b');
  approx(second.c, -1, 'second copy preserves source c');
  approx(second.d, 0, 'second copy preserves source d');
  approx(second.tx, 5, 'second copy advances along local X tx');
  approx(second.ty, 6 + itemWidth, 'second copy advances along local X ty');

  await cleanup(harness.root);

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }

  console.log(`\nAll ${passed} assertions passed.`);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
