/**
 * F45-09-001: Material Test must not insert calibration grids outside the material/bed.
 *
 * Run: npx tsx tests/material-test-bounds-block.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
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

async function renderDialog(scene = createScene(300, 300, 'material test bounds')): Promise<{
  container: HTMLElement;
  root: Root;
  applied: () => Array<{ objects: SceneObject[]; layers: Array<{ power: number; speed: number }> }>;
  closed: () => number;
}> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const applied: Array<{ objects: SceneObject[]; layers: Array<{ power: number; speed: number }> }> = [];
  let closeCount = 0;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MaterialTestDialog, {
      scene,
      onApply: (objects, layers) => { applied.push({ objects, layers }); },
      onClose: () => { closeCount += 1; },
    }));
  });
  return {
    container,
    root,
    applied: () => applied,
    closed: () => closeCount,
  };
}

function generateButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find(candidate => candidate.textContent?.startsWith('Generate ')) as HTMLButtonElement | undefined;
  assert(button != null, 'generate button exists');
  if (!button) throw new Error('generate button missing');
  return button;
}

async function run(): Promise<void> {
  console.log('\n=== F45-09-001 material test bounds block ===\n');

  {
    const exactAuditTrigger = computeMaterialTestLayout(createScene(300, 300), {
      rows: 10,
      cols: 10,
      squareSize: 50,
      gap: 20,
    });
    assert(exactAuditTrigger.gridWidth === 680, 'audit trigger grid width is 680 mm before label footprint');
    assert(exactAuditTrigger.gridHeight === 680, 'audit trigger grid height is 680 mm before label footprint');
    assert(exactAuditTrigger.fits === false, 'audit trigger does not fit a 300 x 300 workspace');
  }

  {
    const { container, root, applied, closed } = await renderDialog(createScene(50, 50, 'small diode'));
    const button = generateButton(container);
    await act(async () => { button.click(); });
    assert(applied().length === 0, 'out-of-bounds material test grid is not applied');
    assert(closed() === 0, 'out-of-bounds material test dialog remains open for correction');
    assert(
      /does not fit|exceeds|outside/i.test(container.textContent ?? '') || button.disabled,
      'out-of-bounds material test shows a bounds warning or disables generate',
    );
    await act(async () => { root.unmount(); });
  }

  {
    const { container, root, applied, closed } = await renderDialog();
    const button = generateButton(container);
    await act(async () => { button.click(); });
    assert(applied().length === 1, 'default material test grid still applies');
    assert(applied()[0]?.objects.length === 52, 'default 5 x 5 grid plus labels is generated');
    assert(closed() === 1, 'successful material test generation closes the dialog');
    await act(async () => { root.unmount(); });
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
