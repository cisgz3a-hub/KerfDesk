/**
 * T1-96: StartReadinessPanel rendering contracts.
 *
 * Run: npx tsx tests/start-readiness-panel.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  StartReadinessPanel,
  type StartReadiness,
  type StartReadinessGate,
} from '../src/ui/components/connection/StartReadinessPanel';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
if (typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame !== 'function') {
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
    configurable: true,
  });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

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

function makeGate(
  id: StartReadinessGate['id'],
  status: StartReadinessGate['status'],
  extras: Partial<StartReadinessGate> = {},
): StartReadinessGate {
  return { id, label: id, status, ...extras };
}

const allOkGates: StartReadinessGate[] = [
  makeGate('controllerConnected', 'ok'),
  makeGate('gcodeCompiled', 'ok'),
  makeGate('gcodeFresh', 'ok'),
  makeGate('preflight', 'ok'),
  makeGate('machineState', 'ok'),
  makeGate('framing', 'ok'),
  makeGate('laserState', 'ok'),
  makeGate('wcsState', 'ok'),
];

async function renderPanel(readiness: StartReadiness): Promise<{ container: HTMLElement; root: Root }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(StartReadinessPanel, { readiness }));
  });
  return { container, root };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

async function run(): Promise<void> {
  console.log('\n=== StartReadinessPanel (T1-96) ===\n');

  {
    const { container, root } = await renderPanel({
      ready: true,
      blockingGate: null,
      gates: allOkGates,
    });
    const panel = container.querySelector('[data-testid="start-readiness-panel"]');
    assert(panel == null, 'ready state renders nothing');
    await cleanup(root);
  }

  {
    const failingGate = makeGate('framing', 'fail', {
      label: 'Job framed',
      failHeadline: 'Frame not done since last design change',
      failAction: 'Click Frame to confirm where the laser will burn',
    });
    const { container, root } = await renderPanel({
      ready: false,
      blockingGate: failingGate,
      gates: allOkGates.map(g => g.id === 'framing' ? failingGate : g),
    });
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLElement | null;
    const list = container.querySelector('[data-testid="start-readiness-list"]');
    assert(
      toggle?.textContent?.includes('Frame not done since last design change') === true && list == null,
      'collapsed state shows first-failing-gate headline and hides the list',
    );
    await cleanup(root);
  }

  {
    const failingGate = makeGate('gcodeFresh', 'fail', {
      label: 'G-code matches current design',
      failHeadline: 'Design changed since last compile',
      failAction: 'Click ↻ Update above to recompile',
    });
    const { container, root } = await renderPanel({
      ready: false,
      blockingGate: failingGate,
      gates: allOkGates.map(g => g.id === 'gcodeFresh' ? failingGate : g),
    });
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    const rows = container.querySelectorAll('[data-testid^="start-readiness-gate-"]');
    const failingRow = container.querySelector('[data-testid="start-readiness-gate-gcodeFresh"]');
    assert(
      rows.length === 8 &&
        failingRow?.getAttribute('data-gate-status') === 'fail' &&
        failingRow.textContent?.includes('Design changed since last compile') === true &&
        failingRow.textContent?.includes('Click ↻ Update above to recompile') === true,
      'expanded state shows all 8 gates with failing-gate status, headline, and action',
    );
    await cleanup(root);
  }

  {
    const preflightGate = makeGate('preflight', 'fail', {
      label: 'Design preflight checks',
      failHeadline: '2 blockers and 1 warning',
      failDetails: [
        { severity: 'blocker', text: 'Layer "Cut" power is 0%' },
        { severity: 'blocker', text: 'Design extends 12 mm beyond bed on +X' },
        { severity: 'warning', text: 'Travel optimization disabled' },
      ],
      failAction: 'Open the Issues panel above to see and fix each one',
    });
    const { container, root } = await renderPanel({
      ready: false,
      blockingGate: preflightGate,
      gates: allOkGates.map(g => g.id === 'preflight' ? preflightGate : g),
    });
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    const row = container.querySelector('[data-testid="start-readiness-gate-preflight"]');
    assert(
      row?.textContent?.includes('Layer "Cut" power is 0%') === true &&
        row.textContent.includes('Design extends 12 mm beyond bed on +X') &&
        row.textContent.includes('Travel optimization disabled'),
      'failing preflight surfaces blocker and warning detail items',
    );
    await cleanup(root);
  }

  {
    const failingGate = makeGate('framing', 'fail', {
      label: 'Job framed',
      failHeadline: 'Frame not done',
      failAction: 'Click Frame',
    });
    const { container, root } = await renderPanel({
      ready: false,
      blockingGate: failingGate,
      gates: allOkGates.map(g => g.id === 'framing' ? failingGate : g),
    });
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    const okRow = container.querySelector('[data-testid="start-readiness-gate-gcodeCompiled"]');
    assert(
      okRow?.getAttribute('data-gate-status') === 'ok' && okRow.textContent?.includes('→') !== true,
      'passing gate row carries ok status and no action hint',
    );
    await cleanup(root);
  }

  {
    const compileFail = makeGate('gcodeCompiled', 'fail', {
      label: 'G-code compiled',
      failHeadline: 'No G-code yet',
      failAction: 'Click G-code',
    });
    const frameFail = makeGate('framing', 'fail', {
      label: 'Job framed',
      failHeadline: 'Frame not done',
      failAction: 'Click Frame',
    });
    const gates = allOkGates
      .map(g => g.id === 'gcodeCompiled' ? compileFail : g)
      .map(g => g.id === 'framing' ? frameFail : g);
    const { container, root } = await renderPanel({
      ready: false,
      blockingGate: compileFail,
      gates,
    });
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLElement | null;
    assert(
      toggle?.textContent?.includes('No G-code yet') === true &&
        toggle.textContent.includes('Frame not done') === false,
      'multiple failures use the first failing gate as the collapsed headline',
    );
    await cleanup(root);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
