/**
 * F45-07-004: Variable Text grid spacing must account for expanded text width.
 *
 * Run: npx tsx tests/variable-text-expanded-spacing.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createLayer } from '../src/core/scene/Layer';
import { createScene } from '../src/core/scene/Scene';
import { type SceneObject } from '../src/core/scene/SceneObject';
import { VariableTextDialog } from '../src/ui/components/VariableTextDialog';

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
    name: 'Serial template',
    layerId,
    parentId: null,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
    geometry: {
      type: 'text',
      text: 'A',
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
}> {
  const container = win.document.getElementById('root') as HTMLElement;
  container.innerHTML = '';
  const root = createRoot(container);
  const layer = createLayer(0, 'engrave', 'Engrave');
  const sourceObject = makeSourceObject(layer.id);
  const scene = {
    ...createScene(300, 200, 'Variable Text Expanded Spacing'),
    layers: [layer],
    activeLayerId: layer.id,
    objects: [sourceObject],
  };
  let generatedObjects: readonly SceneObject[] = [];

  await act(async () => {
    root.render(React.createElement(VariableTextDialog, {
      scene,
      sourceObject,
      onGenerate: (objects) => {
        generatedObjects = objects;
      },
      onClose: () => undefined,
    }));
  });

  return { root, container, generated: () => generatedObjects };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

console.log('\n=== F45-07-004 Variable Text expanded spacing ===\n');

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
  assert((objects[0]?.geometry as { text?: string }).text === 'A 1', 'template without token expands into first label');

  const expandedWidth = 10 * Math.max('A 1'.length, 'A 10'.length) * 0.6 + 10;
  approx(objects[1]?.transform.tx, 10 + expandedWidth, 'second copy uses max expanded text width for X spacing');
  assert(
    objects[1]?.transform.tx > 10 + 10 * Math.max('A'.length, 3) * 0.6 + 10,
    'expanded spacing is larger than the old template-length spacing',
  );

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
