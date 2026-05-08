import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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

type DetailsPanelKey = 'workflow' | 'issues' | 'advanced';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

async function loadModule(): Promise<{
  JobDetailsLaunchers: React.ComponentType<{
    issueCount: number;
    onOpen: (panel: DetailsPanelKey) => void;
  }>;
  ConnectionDetailsPanel: React.ComponentType<{
    activePanel: DetailsPanelKey | null;
    issueCount: number;
    onSelect: (panel: DetailsPanelKey) => void;
    onClose: () => void;
    workflowSection: React.ReactNode;
    issuesSection: React.ReactNode;
    advancedSection: React.ReactNode;
  }>;
}> {
  try {
    return await import('../src/ui/components/connection/ConnectionDetailsPanel');
  } catch {
    assert(false, 'ConnectionDetailsPanel module exists');
    throw new Error('ConnectionDetailsPanel module is missing');
  }
}

async function renderHarness(
  Components: Awaited<ReturnType<typeof loadModule>>,
): Promise<{ container: HTMLElement; root: Root }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  function Harness(): React.ReactElement {
    const [activePanel, setActivePanel] = useState<DetailsPanelKey | null>(null);
    return React.createElement(React.Fragment, null,
      React.createElement(Components.JobDetailsLaunchers, {
        issueCount: 2,
        onOpen: setActivePanel,
      }),
      React.createElement(Components.ConnectionDetailsPanel, {
        activePanel,
        issueCount: 2,
        onSelect: setActivePanel,
        onClose: () => setActivePanel(null),
        workflowSection: React.createElement('div', { 'data-testid': 'workflow-body' }, 'Frame the job'),
        issuesSection: React.createElement('div', { 'data-testid': 'issues-body' }, 'No G-code compiled Readiness: 40%'),
        advancedSection: React.createElement('div', { 'data-testid': 'advanced-body' }, 'Simulator Console G-code'),
      }),
    );
  }

  await act(async () => {
    root.render(React.createElement(Harness));
  });

  return { container, root };
}

async function click(container: HTMLElement, testId: string): Promise<void> {
  const button = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  assert(button != null, `${testId} button exists`);
  await act(async () => {
    button?.click();
  });
}

async function pointerDown(container: HTMLElement, testId: string): Promise<void> {
  const button = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  assert(button != null, `${testId} pointer target exists`);
  await act(async () => {
    button?.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true }));
  });
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

async function run(): Promise<void> {
  console.log('\n=== Connection details panel ===\n');
  const Components = await loadModule();
  const { container, root } = await renderHarness(Components);

  assert(container.querySelector('[data-testid="connection-details-launchers"]') != null, 'main drawer renders detail launchers');
  assert(container.textContent?.includes('Workflow') === true, 'Workflow launcher renders');
  assert(container.textContent?.includes('Issues (2)') === true, 'Issues launcher includes issue count');
  assert(container.textContent?.includes('Advanced') === true, 'Advanced launcher renders');
  assert(container.querySelector('[data-testid="connection-details-panel"]') == null, 'details panel starts closed');

  await pointerDown(container, 'connection-details-open-workflow');
  assert(
    container.querySelector('[data-testid="connection-details-panel"]')?.getAttribute('data-active-panel') === 'workflow' &&
      container.querySelector('[data-testid="workflow-body"]') != null,
    'pointer-down opening Workflow shows workflow content in secondary panel',
  );

  await click(container, 'connection-details-tab-issues');
  assert(
    container.querySelector('[data-testid="connection-details-panel"]')?.getAttribute('data-active-panel') === 'issues' &&
      container.querySelector('[data-testid="issues-body"]')?.textContent?.includes('Readiness: 40%') === true,
    'Issues tab shows issue and readiness content',
  );

  await click(container, 'connection-details-tab-advanced');
  assert(
    container.querySelector('[data-testid="connection-details-panel"]')?.getAttribute('data-active-panel') === 'advanced' &&
      container.querySelector('[data-testid="advanced-body"]')?.textContent?.includes('Simulator Console G-code') === true,
    'Advanced tab shows advanced machine content',
  );

  await click(container, 'connection-details-back');
  assert(container.querySelector('[data-testid="connection-details-panel"]') == null, 'Back closes the details panel');

  await cleanup(root);
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
