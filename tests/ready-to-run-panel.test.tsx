/**
 * T2-58: ReadyToRunPanel rendering contracts.
 *
 * Run: npx tsx tests/ready-to-run-panel.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ReadyToRunPanel,
  type ReadyToRunPanelData,
} from '../src/ui/components/connection/ReadyToRunPanel';
import { analyzeOperationOrder } from '../src/app/OperationOrder';

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
    console.log(`  ok ${msg}`);
  } else {
    failed++;
    console.error(`  fail ${msg}`);
  }
}

const baseData: ReadyToRunPanelData = {
  machine: {
    connectionLabel: 'Connected (Sim)',
    profileLabel: 'Falcon A1 Pro',
    statusLabel: 'idle',
    bedLabel: '400 x 400 mm bed',
    positionLabel: 'X10.0 Y20.0',
  },
  job: {
    summaryLabel: '3 operations',
    boundsLabel: 'X0.0 Y0.0 to X120.0 Y80.0',
    estimatedTimeLabel: '3:42',
    operationAnalysis: analyzeOperationOrder([
      { index: 1, layerName: 'Engrave text', kind: 'engrave', powerPercent: 35, feedRateMmPerMin: 2500, passes: 1 },
      { index: 2, layerName: 'Score fold', kind: 'score', powerPercent: 15, feedRateMmPerMin: 1800, passes: 1 },
      { index: 3, layerName: 'Cut outline', kind: 'cut', powerPercent: 80, feedRateMmPerMin: 220, passes: 2 },
    ]),
  },
  material: {
    label: '3mm Birch Plywood',
    sizeLabel: '200 x 150 x 3 mm',
    reminders: [
      { id: 'focus', label: 'Focus checked' },
      { id: 'hold-down', label: 'Material held flat' },
    ],
  },
  position: {
    startModeLabel: 'Start from laser head',
    originLabel: 'Job starts at current head position',
    frameStatusLabel: 'Frame complete',
  },
  warnings: [
    { id: 'air', severity: 'warning', text: 'Air assist is off' },
  ],
  canStartJob: true,
  startBlockedReason: null,
};

async function renderPanel(
  data: ReadyToRunPanelData,
  onStartJob = () => undefined,
): Promise<{ container: HTMLElement; root: Root }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(ReadyToRunPanel, { data, onStartJob, startLabel: 'START (Sim)' }));
  });
  return { container, root };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

async function run(): Promise<void> {
  console.log('\n=== ReadyToRunPanel (T2-58) ===\n');

  {
    const { container, root } = await renderPanel(baseData);
    const text = container.textContent ?? '';
    assert(
      text.includes('Job Review') &&
        text.includes('Machine') &&
        text.includes('Job') &&
        text.includes('Material') &&
        text.includes('Position') &&
        text.includes('Warnings') &&
        text.includes('Operation order'),
      'renders all top-level preflight sections',
    );
    assert(
      container.querySelector('[data-testid="ready-to-run-start"]') === null,
      'does not render a duplicate Start button inside the review panel',
    );
    await cleanup(root);
  }

  {
    const blocked = {
      ...baseData,
      canStartJob: false,
      startBlockedReason: 'Frame not done since last design change',
    };
    const { container, root } = await renderPanel(blocked);
    assert(
      container.querySelector('[data-testid="ready-to-run-start"]') === null &&
        container.textContent?.includes('Frame not done since last design change') === true,
      'disables Start with the blocking reason when canStartJob is false',
    );
    await cleanup(root);
  }

  {
    let starts = 0;
    const { container, root } = await renderPanel(baseData, () => { starts++; });
    const focus = container.querySelector('[data-testid="ready-to-run-reminder-focus"]') as HTMLInputElement | null;
    const holdDown = container.querySelector('[data-testid="ready-to-run-reminder-hold-down"]') as HTMLInputElement | null;
    await act(async () => {
      focus?.click();
      root.render(React.createElement(ReadyToRunPanel, { data: baseData, onStartJob: () => { starts++; }, startLabel: 'START (Sim)' }));
    });
    const focusAfter = container.querySelector('[data-testid="ready-to-run-reminder-focus"]') as HTMLInputElement | null;
    const holdDownAfter = container.querySelector('[data-testid="ready-to-run-reminder-hold-down"]') as HTMLInputElement | null;
    assert(
      starts === 0 &&
        container.querySelector('[data-testid="ready-to-run-start"]') === null &&
        focusAfter?.checked === true &&
        holdDown?.checked === false &&
        holdDownAfter?.checked === false,
      'material reminders stay local to the review panel and checkbox state persists across rerenders',
    );
    await cleanup(root);
  }

  {
    const warningData: ReadyToRunPanelData = {
      ...baseData,
      job: {
        ...baseData.job,
        operationAnalysis: analyzeOperationOrder([
          { index: 1, layerName: 'Cut outline', kind: 'cut', powerPercent: 80, feedRateMmPerMin: 220, passes: 1 },
          { index: 2, layerName: 'Engrave text', kind: 'engrave', powerPercent: 35, feedRateMmPerMin: 2500, passes: 1 },
        ]),
      },
    };
    const { container, root } = await renderPanel(warningData);
    const rows = Array.from(container.querySelectorAll('[data-testid^="ready-to-run-operation-"]'));
    assert(
      rows.length === 2 &&
        rows[0].textContent?.includes('1. Cut - Cut outline') === true &&
        rows[1].textContent?.includes('2. Engrave - Engrave text') === true &&
        container.textContent?.includes('piece may shift') === true,
      'operation order renders in analysis order with cut-before-engrave warning',
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
