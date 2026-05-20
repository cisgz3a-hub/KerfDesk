/**
 * F45-09-003: G-code Test must reject zero-speed and negative-origin output.
 *
 * Run: npx tsx tests/test-grid-dialog-validation.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_TEST_GRID, generateTestGrid, type TestGridOptions } from '../src/core/tools/TestGridGenerator';
import { TestGridDialog } from '../src/ui/components/TestGridDialog';

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

function assertThrows(fn: () => unknown, pattern: RegExp, message: string): void {
  try {
    fn();
    assert(false, message);
  } catch (err) {
    assert(pattern.test(String((err as Error).message)), message);
  }
}

async function renderDialog(): Promise<{
  container: HTMLElement;
  root: Root;
  previews: () => string[];
  generations: () => string[];
}> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const previews: string[] = [];
  const generations: string[] = [];
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(TestGridDialog, {
      open: true,
      defaultMaxSpindle: 1000,
      defaultBedWidth: 300,
      defaultBedHeight: 300,
      onClose: () => undefined,
      onPreview: gcode => { previews.push(gcode); },
      onGenerate: gcode => { generations.push(gcode); },
    }));
  });
  return {
    container,
    root,
    previews: () => previews,
    generations: () => generations,
  };
}

function patchDefaultGrid(patch: Partial<TestGridOptions>): () => void {
  const original: TestGridOptions = {
    ...DEFAULT_TEST_GRID,
    powers: [...DEFAULT_TEST_GRID.powers],
    speeds: [...DEFAULT_TEST_GRID.speeds],
  };
  Object.assign(DEFAULT_TEST_GRID, {
    ...patch,
    powers: patch.powers ? [...patch.powers] : DEFAULT_TEST_GRID.powers,
    speeds: patch.speeds ? [...patch.speeds] : DEFAULT_TEST_GRID.speeds,
  });
  return () => {
    Object.assign(DEFAULT_TEST_GRID, original);
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find(candidate => candidate.textContent === text) as HTMLButtonElement | undefined;
  assert(button != null, `${text} button exists`);
  if (!button) throw new Error(`${text} button missing`);
  return button;
}

async function run(): Promise<void> {
  console.log('\n=== F45-09-003 TestGrid validation ===\n');

  {
    const zeroSpeed: TestGridOptions = {
      ...DEFAULT_TEST_GRID,
      powers: [100],
      speeds: [0],
      includeLabels: false,
    };
    assertThrows(() => generateTestGrid(zeroSpeed), /speed/i, 'generator rejects zero feed rates');

    const negativeOrigin: TestGridOptions = {
      ...DEFAULT_TEST_GRID,
      powers: [100],
      speeds: [1000],
      originX: -20,
      originY: -3,
      includeLabels: false,
    };
    assertThrows(() => generateTestGrid(negativeOrigin), /origin/i, 'generator rejects negative origins');
  }

  {
    const restore = patchDefaultGrid({ speeds: [0] });
    const { container, root, previews, generations } = await renderDialog();
    restore();
    const preview = buttonByText(container, 'Preview G-code');
    const generate = buttonByText(container, 'Generate G-code');
    assert(preview.disabled, 'zero-speed list disables preview');
    assert(generate.disabled, 'zero-speed list disables generate');
    await act(async () => { preview.click(); generate.click(); });
    assert(previews().length === 0, 'zero-speed list does not preview');
    assert(generations().length === 0, 'zero-speed list does not generate');
    await act(async () => { root.unmount(); });
  }

  {
    const restore = patchDefaultGrid({ originX: -20, originY: -3 });
    const { container, root, previews, generations } = await renderDialog();
    restore();
    const preview = buttonByText(container, 'Preview G-code');
    const generate = buttonByText(container, 'Generate G-code');
    assert(preview.disabled, 'negative origin disables preview');
    assert(generate.disabled, 'negative origin disables generate');
    await act(async () => { preview.click(); generate.click(); });
    assert(previews().length === 0, 'negative origin does not preview');
    assert(generations().length === 0, 'negative origin does not generate');
    await act(async () => { root.unmount(); });
  }

  {
    const { container, root, previews, generations } = await renderDialog();
    const preview = buttonByText(container, 'Preview G-code');
    const generate = buttonByText(container, 'Generate G-code');
    assert(!preview.disabled, 'valid default grid enables preview');
    assert(!generate.disabled, 'valid default grid enables generate');
    await act(async () => { preview.click(); });
    await act(async () => { generate.click(); });
    assert(previews().length === 1 && !previews()[0]?.includes('F0'), 'valid default preview produces positive-feed G-code');
    assert(generations().length === 1 && !generations()[0]?.includes('F0'), 'valid default generate produces positive-feed G-code');
    await act(async () => { root.unmount(); });
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
