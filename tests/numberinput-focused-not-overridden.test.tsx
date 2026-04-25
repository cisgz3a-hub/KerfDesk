/**
 * NumberInput should not override user typing while focused.
 * Run: npx tsx tests/numberinput-focused-not-overridden.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NumberInput } from '../src/ui/components/NumberInput';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = win;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = win.document;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number;
}
if (typeof (win.HTMLElement.prototype as { attachEvent?: unknown }).attachEvent !== 'function') {
  (win.HTMLElement.prototype as { attachEvent: () => void }).attachEvent = () => {};
}
if (typeof (win.HTMLElement.prototype as { detachEvent?: unknown }).detachEvent !== 'function') {
  (win.HTMLElement.prototype as { detachEvent: () => void }).detachEvent = () => {};
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

async function run(): Promise<void> {
  console.log('\n=== NumberInput focused value is not overridden ===\n');
  const container = win.document.getElementById('root')!;
  let root: Root | null = createRoot(container);
  let setPropValue: ((v: number) => void) | null = null;

  function Harness(): React.ReactElement {
    const [propValue, setInnerPropValue] = useState(5);
    setPropValue = setInnerPropValue;
    return React.createElement(NumberInput, { value: propValue, onChange: () => {} });
  }

  await act(async () => {
    root!.render(React.createElement(Harness));
  });
  const input = container.querySelector('input') as HTMLInputElement | null;
  assert(input != null, 'input rendered');
  if (!input) process.exit(1);

  await act(async () => {
    input.dispatchEvent(new win.Event('focusin', { bubbles: true }));
  });
  await act(async () => {
    input.value = '12';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  });
  assert(input.value === '12', 'typing while focused updates local value');

  await act(async () => {
    setPropValue?.(5);
  });
  assert(input.value === '12', 'focused local value not replaced by incoming prop');

  if (root) {
    await act(async () => {
      root!.unmount();
      root = null;
    });
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
