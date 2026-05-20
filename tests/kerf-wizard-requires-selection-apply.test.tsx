/**
 * F45-10-003: Kerf Wizard must not apply compensation to every visible object
 * when no objects are selected.
 *
 * Run: npx tsx tests/kerf-wizard-requires-selection-apply.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
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

function makeScene(): { scene: Scene; firstId: string; secondId: string } {
  const scene = createScene(300, 300, 'kerf apply selection');
  const layerId = scene.layers[0].id;
  const first = createRect(layerId, 20, 20, 30, 30);
  const second = createRect(layerId, 80, 20, 30, 30);
  return {
    scene: { ...scene, objects: [first, second] },
    firstId: first.id,
    secondId: second.id,
  };
}

async function mountApplyStep(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): Promise<{
  container: HTMLElement;
  root: Root;
  applied: () => { offset: number; ids: string[] } | null;
  closeCount: () => number;
}> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  win.localStorage.setItem('laserforge_kerf', '0.4');
  let applied: { offset: number; ids: string[] } | null = null;
  let closed = 0;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(KerfWizard, {
      scene,
      selectedIds,
      onGenerateTestPiece: () => undefined,
      onApplyKerf: (offset, ids) => { applied = { offset, ids }; },
      onSaveToPreset: () => undefined,
      onClose: () => { closed++; },
    }));
  });
  await clickButton(container, 'Use saved kerf');
  return {
    container,
    root,
    applied: () => applied,
    closeCount: () => closed,
  };
}

async function run(): Promise<void> {
  console.log('\n=== F45-10-003 Kerf Wizard requires selected apply target ===\n');

  {
    const { scene } = makeScene();
    const { container, root, applied, closeCount } = await mountApplyStep(scene, new Set());
    const applyButton = buttonByText(container, 'Save & Apply to Design');
    assert(applyButton?.disabled === true, 'Save & Apply is disabled with no selected objects');
    assert((container.textContent ?? '').includes('Select one or more objects'), 'No-selection apply warning is visible');
    await clickButton(container, 'Save & Apply to Design');
    assert(applied() === null, 'No-selection apply does not call onApplyKerf');
    assert(closeCount() === 0, 'No-selection apply does not close the wizard');
    await act(async () => { root.unmount(); });
  }

  {
    const { scene, firstId, secondId } = makeScene();
    const { container, root, applied, closeCount } = await mountApplyStep(scene, new Set([firstId]));
    const applyButton = buttonByText(container, 'Save & Apply to Design');
    assert(applyButton?.disabled === false, 'Save & Apply is enabled with selected objects');
    await clickButton(container, 'Save & Apply to Design');
    assert(applied()?.ids.join(',') === firstId, 'Selected apply passes only the selected object id');
    assert(applied()?.ids.includes(secondId) === false, 'Selected apply does not include unselected visible objects');
    assert(applied()?.offset === 0.2, 'Selected apply uses half the saved kerf as outward offset');
    assert(closeCount() === 1, 'Selected apply closes the wizard after applying');
    await act(async () => { root.unmount(); });
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
