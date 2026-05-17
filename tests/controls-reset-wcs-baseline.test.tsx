/**
 * Regression coverage for the direct Reset WCS control in the run-job
 * footer. The WCS reset existed inside the readiness details, but it was
 * too easy to hide behind another blocking gate. The footer button keeps
 * the recovery action reachable while the machine is connected, idle, and
 * laser-off without weakening Start safety gates.
 *
 * Run: npx tsx tests/controls-reset-wcs-baseline.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Controls } from '../src/ui/components/connection/Controls';
import type { StartReadiness } from '../src/ui/components/connection/StartReadinessPanel';

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

const ready: StartReadiness = {
  ready: true,
  blockingGate: null,
  gates: [],
};

async function renderControls(extra: Record<string, unknown>): Promise<{ container: HTMLElement; root: Root }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Controls, {
      canFrame: true,
      canStartJob: false,
      isSimulator: false,
      isRunning: false,
      displayPaused: false,
      startReadiness: ready,
      onFrame: () => undefined,
      onStartJob: () => undefined,
      onPauseResume: () => undefined,
      onStop: () => undefined,
      ...extra,
    }));
  });
  return { container, root };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

async function run(): Promise<void> {
  console.log('\n=== Controls Reset WCS baseline button ===\n');

  {
    let resets = 0;
    const { container, root } = await renderControls({
      canResetWcsToBaseline: true,
      onResetWcsToBaseline: () => { resets++; },
    });
    const button = container.querySelector('[data-testid="connection-reset-wcs-baseline"]') as HTMLButtonElement | null;
    assert(button != null, 'Run Job footer renders a direct Reset WCS button');
    assert(button?.disabled === false, 'Reset WCS button is enabled when the safe gate allows it');
    await act(async () => {
      button?.click();
    });
    assert(resets === 1, 'Reset WCS button invokes the baseline reset callback exactly once');
    await cleanup(root);
  }

  {
    let resets = 0;
    const { container, root } = await renderControls({
      canResetWcsToBaseline: false,
      onResetWcsToBaseline: () => { resets++; },
    });
    const button = container.querySelector('[data-testid="connection-reset-wcs-baseline"]') as HTMLButtonElement | null;
    assert(button != null, 'Run Job footer still shows Reset WCS when temporarily unsafe');
    assert(button?.disabled === true, 'Reset WCS button is disabled when the safe gate blocks it');
    await act(async () => {
      button?.click();
    });
    assert(resets === 0, 'disabled Reset WCS button does not invoke the callback');
    await cleanup(root);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
