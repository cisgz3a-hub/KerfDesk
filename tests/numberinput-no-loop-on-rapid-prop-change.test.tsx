/**
 * NumberInput should remain stable under rapid prop churn.
 * Run: npx tsx tests/numberinput-no-loop-on-rapid-prop-change.test.tsx
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
let renderCount = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function CountingHarness(props: { value: number }): React.ReactElement {
  renderCount++;
  return React.createElement(NumberInput, { value: props.value, onChange: () => {} });
}

async function run(): Promise<void> {
  console.log('\n=== NumberInput rapid prop churn has bounded renders ===\n');
  const container = win.document.getElementById('root')!;
  let root: Root | null = createRoot(container);

  const errLogs: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errLogs.push(args.map(String).join(' '));
    origError(...args);
  };

  try {
    await act(async () => {
      root!.render(React.createElement(CountingHarness, { value: 0 }));
    });

    for (let i = 1; i <= 50; i++) {
      await act(async () => {
        root!.render(React.createElement(CountingHarness, { value: i }));
      });
    }
  } finally {
    console.error = origError;
    if (root) {
      await act(async () => {
        root!.unmount();
        root = null;
      });
    }
  }

  assert(renderCount < 120, `render count remains bounded (got ${renderCount})`);
  assert(
    !errLogs.some(m => m.includes('Maximum update depth exceeded')),
    'no React maximum update depth error under rapid prop changes',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
