/**
 * F45-10-002: Kerf Wizard must not insert coupons outside material/bed bounds.
 *
 * Run: npx tsx tests/kerf-wizard-bounds-block.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene, type Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import { KerfWizard } from '../src/ui/components/KerfWizard';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: win.localStorage, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

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

function sceneWithMaterial(width: number, height: number): Scene {
  return {
    ...createScene(width, height, 'kerf wizard bounds'),
    material: {
      type: 'wood',
      name: `${width}x${height} test sheet`,
      width,
      height,
      x: 0,
      y: 0,
      thickness: 3,
      color: '#d9b382',
      enabled: true,
    },
  };
}

function buttonByText(container: Element, text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button'))
    .find(button => (button.textContent ?? '').includes(text)) ?? null;
}

async function clickButton(container: Element, text: string): Promise<HTMLButtonElement | null> {
  const button = buttonByText(container, text);
  assert(button != null, `${text} button exists`);
  if (!button) return null;
  await act(async () => {
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  });
  return button;
}

async function mountWizard(scene: Scene): Promise<{ container: HTMLElement; root: Root; generated: () => SceneObject[] }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  let generated: SceneObject[] = [];
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(KerfWizard, {
      scene,
      selectedIds: new Set<string>(),
      onGenerateTestPiece: objects => { generated = objects; },
      onApplyKerf: () => undefined,
      onSaveToPreset: () => undefined,
      onClose: () => undefined,
    }));
  });
  await clickButton(container, 'Start Kerf Test');
  return { container, root, generated: () => generated };
}

async function run(): Promise<void> {
  console.log('\n=== F45-10-002 Kerf Wizard bounds block ===\n');

  {
    const { container, root, generated } = await mountWizard(sceneWithMaterial(80, 80));
    const addButton = buttonByText(container, 'Add to Canvas');
    assert(addButton?.disabled === true, 'out-of-bounds coupon disables Add to Canvas');
    assert((container.textContent ?? '').toLowerCase().includes('does not fit'), 'out-of-bounds coupon shows a fit warning');
    await clickButton(container, 'Add to Canvas');
    assert(generated().length === 0, 'out-of-bounds coupon is not generated');
    await act(async () => { root.unmount(); });
  }

  {
    const { container, root, generated } = await mountWizard(sceneWithMaterial(300, 300));
    const addButton = buttonByText(container, 'Add to Canvas');
    assert(addButton?.disabled === false, 'normal coupon keeps Add to Canvas enabled');
    await clickButton(container, 'Add to Canvas');
    assert(generated().length > 0, 'normal coupon still generates');
    await act(async () => { root.unmount(); });
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
