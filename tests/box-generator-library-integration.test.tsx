/**
 * Box Studio library integration contracts.
 * Run: npx tsx tests/box-generator-library-integration.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BoxStudioWorkspace } from '../src/ui/components/box-library/BoxStudioWorkspace';
import { createScene } from '../src/core/scene/Scene';

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
if (typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame !== 'function') {
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
    configurable: true,
  });
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

const scene = createScene();

async function renderGenerator(): Promise<{ container: HTMLElement; root: Root }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(BoxStudioWorkspace, {
      scene,
      onGenerate: () => {},
    }));
  });
  return { container, root };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => { root.unmount(); });
}

function inputByDisplayValue(container: HTMLElement, value: string): HTMLInputElement | null {
  return [...container.querySelectorAll('input')]
    .find(input => (input as HTMLInputElement).value === value) as HTMLInputElement | null;
}

async function run(): Promise<void> {
  console.log('\n=== box studio library integration ===\n');

  {
    const { container, root } = await renderGenerator();
    const trayCard = container.querySelector('[data-testid="box-preset-card-open-parts-tray"]') as HTMLButtonElement;
    await act(async () => { trayCard.click(); });
    assert(inputByDisplayValue(container, '120') == null, 'selecting preset previews only and does not apply dimensions');
    const apply = container.querySelector('[data-testid="box-use-preset"]') as HTMLButtonElement;
    await act(async () => { apply.click(); });
    assert(inputByDisplayValue(container, '120') != null, 'applying preset updates width');
    assert(inputByDisplayValue(container, '80') != null, 'applying preset updates depth');
    assert(container.textContent?.includes('Open top') === true, 'applying tray updates openTop');
    await cleanup(root);
  }

  {
    const { container, root } = await renderGenerator();
    const electronics = container.querySelector('[data-testid="box-preset-card-arduino-enclosure"]') as HTMLButtonElement;
    await act(async () => { electronics.click(); });
    const apply = container.querySelector('[data-testid="box-use-preset"]') as HTMLButtonElement;
    await act(async () => { apply.click(); });
    assert(inputByDisplayValue(container, '0.06') != null, 'applying electronics preset updates fit allowance');
    assert(inputByDisplayValue(container, '0.1') != null, 'applying electronics preset updates kerf');
    assert(container.querySelector('[data-testid="box-preset-source"]')?.textContent?.includes('Arduino Enclosure') === true,
      'applied preset source is shown');
    await cleanup(root);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
