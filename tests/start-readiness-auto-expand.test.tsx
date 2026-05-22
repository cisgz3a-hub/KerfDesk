/**
 * Controller UX regression: StartReadinessPanel must never auto-open.
 * Jogging can invalidate currentModeAnchor/framing readiness, but the
 * checklist should remain collapsed until the user explicitly expands it.
 *
 * The collapsed headline may update as gates change. The details list is
 * user-owned state, not a side effect of jogging/framing/WCS changes.
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
    console.log(`  PASS ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
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

function assertCollapsed(container: HTMLElement, message: string): void {
  const toggle = container.querySelector('[data-testid="start-readiness-toggle"]');
  const list = container.querySelector('[data-testid="start-readiness-list"]');
  assert(toggle?.getAttribute('aria-expanded') === 'false' && list == null, message);
}

async function run(): Promise<void> {
  console.log('\n=== StartReadinessPanel no automatic opening ===\n');

  {
    const { container, root } = await renderPanel(makeReadinessFor('currentModeAnchor'));
    assertCollapsed(container, 'currentModeAnchor gate mounts collapsed after jog/current-position invalidation');
    await cleanup(root);
  }

  {
    const { container, root } = await renderPanel(makeReadinessFor('framing'));
    assertCollapsed(container, 'framing gate mounts collapsed');
    await cleanup(root);
  }

  {
    const { container, root } = await renderPanel(makeReadinessFor('frameControls'));
    assertCollapsed(container, 'frameControls gate mounts collapsed');
    await cleanup(root);
  }

  {
    const { container, root } = await renderPanel(makeReadinessFor('wcsState'));
    assertCollapsed(container, 'wcsState gate mounts collapsed');
    await cleanup(root);
  }

  {
    const { container, root } = await renderPanel(makeReadinessFor('controllerConnected'));
    assertCollapsed(container, 'controllerConnected setup gate still mounts collapsed');
    await cleanup(root);
  }

  {
    const { container, root } = await renderPanel(makeReadinessFor('gcodeCompiled'));
    assertCollapsed(container, 'gcodeCompiled setup gate still mounts collapsed');
    await cleanup(root);
  }

  {
    const { container, root } = await renderPanel(makeReadinessFor('currentModeAnchor'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    assert(toggle.getAttribute('aria-expanded') === 'false', 'manual-expand precondition: panel started collapsed');
    await act(async () => { toggle.click(); });
    assert(toggle.getAttribute('aria-expanded') === 'true', 'manual expansion takes effect');
    await rerender(root, makeReadinessFor('currentModeAnchor'));
    assert(toggle.getAttribute('aria-expanded') === 'true', 'same blocking gate re-render does not close a user-opened panel');
    await cleanup(root);
  }

  {
    const { container, root } = await renderPanel(makeReadinessFor('controllerConnected'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    assert(toggle.getAttribute('aria-expanded') === 'false', 'transition precondition: started collapsed');
    await rerender(root, makeReadinessFor('currentModeAnchor'));
    assert(
      toggle.getAttribute('aria-expanded') === 'false',
      'blocking gate transition controllerConnected -> currentModeAnchor stays collapsed',
    );
    await cleanup(root);
  }

  {
    const { container, root } = await renderPanel(makeReadinessFor('controllerConnected'));
    const toggle = container.querySelector('[data-testid="start-readiness-toggle"]') as HTMLButtonElement;
    assert(toggle.getAttribute('aria-expanded') === 'false', 'non-auto transition precondition: started collapsed');
    await rerender(root, makeReadinessFor('gcodeCompiled'));
    assert(toggle.getAttribute('aria-expanded') === 'false', 'transition between setup gates keeps panel collapsed');
    await cleanup(root);
  }

  {
    const controlsPath = path.resolve(__dirname, '..', 'src', 'ui', 'components', 'connection', 'Controls.tsx');
    const src = fs.readFileSync(controlsPath, 'utf8');
    assert(
      /color:\s*canStartJob\s*\?\s*'#2dd4a0'\s*:\s*'#8888a0'/.test(src),
      'Controls.tsx disabled Start uses #8888a0',
    );
    assert(
      /border:\s*canStartJob\s*\?\s*'1px solid #2dd4a0'\s*:\s*'1px solid #3a3a55'/.test(src),
      'Controls.tsx disabled Start border uses #3a3a55',
    );
    assert(!src.includes("'#333355'"), 'Controls.tsx does not reference old low-contrast #333355');
  }

  {
    const anchorPath = path.resolve(__dirname, '..', 'src', 'app', 'CurrentFrameAnchor.ts');
    const src = fs.readFileSync(anchorPath, 'utf8');
    assert(
      /CURRENT_FRAME_ANCHOR_TOLERANCE_MM\s*=\s*0\.25/.test(src),
      'Head-mode anchor tolerance still 0.25mm',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
