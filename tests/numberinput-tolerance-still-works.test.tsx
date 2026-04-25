/**
 * NumberInput retains tolerance smoothing for tiny numeric drift.
 * Run: npx tsx tests/numberinput-tolerance-still-works.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
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
  console.log('\n=== NumberInput tolerance behavior ===\n');
  const container = win.document.getElementById('root')!;
  let root: Root | null = createRoot(container);

  await act(async () => {
    root!.render(React.createElement(NumberInput, { value: 1.0 }));
  });
  const input = container.querySelector('input') as HTMLInputElement | null;
  assert(input != null, 'input rendered');
  if (!input) process.exit(1);
  const before = input.value;

  await act(async () => {
    root!.render(React.createElement(NumberInput, { value: 1.00001 }));
  });
  const after = input.value;
  assert(before === after, `display string unchanged within tolerance (before=${before}, after=${after})`);

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
