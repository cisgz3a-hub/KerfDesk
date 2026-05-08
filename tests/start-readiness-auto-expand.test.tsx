/**
 * T1-110: StartReadinessPanel auto-expands when the blocking gate
 * is one the user just invalidated (currentModeAnchor / framing /
 * frameControls), so the explanation is immediately visible
 * instead of one click away.
 *
 * Other gates (controllerConnected, gcodeCompiled, etc.) — which
 * represent long-lived setup state — keep the pre-T1-110
 * collapsed-by-default behavior.
 *
 * Run: npx tsx tests/start-readiness-auto-expand.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  StartReadinessPanel,
  type StartReadiness,
  type StartReadinessGate,
} from '../src/ui/components/connection/StartReadinessPanel';
import * as fs from 'fs';
import * as path from 'path';

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
  makeGate('frameControls', 'ok'),
  makeGate('framing', 'ok'),
  makeGate('currentModeAnchor', 'ok'),
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

async function rerender(root: Root, readiness: StartReadiness): Promise<void> {
  await act(async () => {
    root.render(React.createElement(StartReadinessPanel, { readiness }));
  });
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

function makeReadinessFor(gateId: StartReadinessGate['id']): StartReadiness {
  const failingGate = makeGate(gateId, 'fail', {
    failHeadline: `${gateId} failure`,
    failAction: `fix ${gateId}`,
  });
  return {
    ready: false,
    blockingGate: failingGate,
    gates: allOkGates.map(g => g.id === gateId ? failingGate : g),
  };
}

async function run(): Promise<void> {
  console.log('\n=== T1-110 StartReadinessPanel auto-expand ===\n');

  // 1. currentModeAnchor → auto-expanded
  {
    const { container, root } = await renderPanel(makeReadinessFor('currentModeAnchor'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]');
    const list = container.querySelector('[data-testid="start-readiness-list"]');
    assert(
      toggle?.getAttribute('aria-expanded') === 'true' && list != null,
      'currentModeAnchor blocking gate → panel mounts expanded',
    );
    await cleanup(root);
  }

  // 2. framing → auto-expanded
  {
    const { container, root } = await renderPanel(makeReadinessFor('framing'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]');
    assert(
      toggle?.getAttribute('aria-expanded') === 'true',
      'framing blocking gate → panel mounts expanded',
    );
    await cleanup(root);
  }

  // 3. frameControls → auto-expanded
  {
    const { container, root } = await renderPanel(makeReadinessFor('frameControls'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]');
    assert(
      toggle?.getAttribute('aria-expanded') === 'true',
      'frameControls blocking gate → panel mounts expanded',
    );
    await cleanup(root);
  }

  // 4. controllerConnected (setup state) → collapsed by default
  {
    const { container, root } = await renderPanel(makeReadinessFor('controllerConnected'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]');
    const list = container.querySelector('[data-testid="start-readiness-list"]');
    assert(
      toggle?.getAttribute('aria-expanded') === 'false' && list == null,
      'controllerConnected blocking gate → panel mounts collapsed (setup gate UX preserved)',
    );
    await cleanup(root);
  }

  // 5. gcodeCompiled (setup state) → collapsed by default
  {
    const { container, root } = await renderPanel(makeReadinessFor('gcodeCompiled'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]');
    assert(
      toggle?.getAttribute('aria-expanded') === 'false',
      'gcodeCompiled blocking gate → panel mounts collapsed',
    );
    await cleanup(root);
  }

  // 6. Manual collapse persists during the same blocking gate
  {
    const { container, root } = await renderPanel(makeReadinessFor('currentModeAnchor'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    assert(
      toggle.getAttribute('aria-expanded') === 'true',
      'manual-collapse precondition: panel started expanded',
    );
    // User collapses
    await act(async () => { toggle.click(); });
    assert(
      toggle.getAttribute('aria-expanded') === 'false',
      'manual collapse takes effect',
    );
    // Same gate still failing — re-render with same id
    await rerender(root, makeReadinessFor('currentModeAnchor'));
    assert(
      toggle.getAttribute('aria-expanded') === 'false',
      'same blocking gate re-render does NOT override user collapse',
    );
    await cleanup(root);
  }

  // 7. Transition to a NEW auto-expand gate re-expands
  {
    const { container, root } = await renderPanel(makeReadinessFor('currentModeAnchor'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    assert(
      toggle.getAttribute('aria-expanded') === 'false',
      'transition precondition: user collapsed currentModeAnchor view',
    );
    await rerender(root, makeReadinessFor('framing'));
    assert(
      toggle.getAttribute('aria-expanded') === 'true',
      'blocking gate transition currentModeAnchor → framing re-expands the panel',
    );
    await cleanup(root);
  }

  // 8. Transition from auto-expand to non-auto-expand DOES NOT auto-expand
  {
    const { container, root } = await renderPanel(makeReadinessFor('controllerConnected'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    assert(
      toggle.getAttribute('aria-expanded') === 'false',
      'transition precondition: started collapsed for controllerConnected',
    );
    await rerender(root, makeReadinessFor('gcodeCompiled'));
    assert(
      toggle.getAttribute('aria-expanded') === 'false',
      'transition between two non-auto-expand gates keeps panel collapsed',
    );
    await cleanup(root);
  }

  // 9. Source-pin: disabled-Start contrast bumped per T1-110
  {
    const controlsPath = path.resolve(__dirname, '..', 'src', 'ui', 'components', 'connection', 'Controls.tsx');
    const src = fs.readFileSync(controlsPath, 'utf8');
    assert(
      /color:\s*canStartJob\s*\?\s*'#2dd4a0'\s*:\s*'#8888a0'/.test(src),
      'Controls.tsx disabled Start uses #8888a0 (was #333355 pre-T1-110)',
    );
    assert(
      /border:\s*canStartJob\s*\?\s*'1px solid #2dd4a0'\s*:\s*'1px solid #3a3a55'/.test(src),
      'Controls.tsx disabled Start border uses #3a3a55 (was #252540 pre-T1-110)',
    );
    assert(
      !src.includes("'#333355'"),
      'Controls.tsx no longer references the old low-contrast #333355',
    );
  }

  // 10. Source-pin: 0.25mm Head-mode anchor tolerance unchanged
  {
    const anchorPath = path.resolve(__dirname, '..', 'src', 'app', 'CurrentFrameAnchor.ts');
    const src = fs.readFileSync(anchorPath, 'utf8');
    assert(
      /CURRENT_FRAME_ANCHOR_TOLERANCE_MM\s*=\s*0\.25/.test(src),
      'Head-mode anchor tolerance still 0.25mm (T1-110 ships UX, not a tolerance change)',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
