/**
 * useModal: confirmWithCheckbox resolution without rendering the full App shell.
 */
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import React, { useLayoutEffect, act } from 'react';
import { useModal } from '../src/ui/hooks/useModal';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
// Make React DOM’s createRoot / scheduler see a minimal browser-like global (Node 22+ has
// a read-only navigator, so we avoid clobbering it and only set document/window).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = win;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = win.document;
// React 19 scheduler can use rAF
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

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

const container = win.document.getElementById('root')!;

type ModalApi = ReturnType<typeof useModal>;

let hookStore: { api: ModalApi | null } = { api: null };

function CaptureHook() {
  const api = useModal();
  useLayoutEffect(() => {
    hookStore.api = api;
  });
  return null;
}

let root: Root | null = null;

function mount(): void {
  hookStore = { api: null };
  if (root) root.unmount();
  root = createRoot(container);
  root.render(React.createElement(CaptureHook));
}

async function getApi(): Promise<ModalApi> {
  for (let i = 0; i < 50; i++) {
    if (hookStore.api) return hookStore.api;
    await flush();
  }
  throw new Error('useModal did not become available');
}

async function unmountAll(): Promise<void> {
  if (root) {
    root.unmount();
    root = null;
  }
  await flush();
}

async function main(): Promise<void> {
  console.log('\n=== useModal: confirmWithCheckbox — OK, checkbox on ===');
  {
    mount();
    const api = await getApi();
    const p = api.showConfirmWithCheckbox('T', 'M', "Don't", 'D');
    await act(() => {
      api.finishConfirmWithCheckbox({ ok: true, checkboxChecked: true });
    });
    const r = await p;
    assert(r.ok === true && r.checkboxChecked === true, 'OK with checkbox on');
    await unmountAll();
  }

  console.log('\n=== useModal: confirmWithCheckbox — OK, checkbox off ===');
  {
    mount();
    const api = await getApi();
    const p = api.showConfirmWithCheckbox('T2', 'M2', "Don't 2");
    await flush();
    api.finishConfirmWithCheckbox({ ok: true, checkboxChecked: false });
    const r = await p;
    assert(r.ok === true && r.checkboxChecked === false, 'OK without checkbox');
    await unmountAll();
  }

  console.log('\n=== useModal: confirmWithCheckbox — cancel via finish ===');
  {
    mount();
    const api = await getApi();
    const p = api.showConfirmWithCheckbox('T3', 'M3', "Don't 3");
    await flush();
    api.finishConfirmWithCheckbox({ ok: false, checkboxChecked: false });
    const r = await p;
    assert(r.ok === false && r.checkboxChecked === false, 'Explicit cancel result');
    await unmountAll();
  }

  console.log('\n=== useModal: confirmWithCheckbox — dismissModal ===');
  {
    mount();
    const api = await getApi();
    const p = api.showConfirmWithCheckbox('T4', 'M4', "Don't 4");
    await flush();
    api.dismissModal();
    const r = await p;
    assert(r.ok === false && r.checkboxChecked === false, 'dismiss matches cancel');
    await unmountAll();
  }
}

void main()
  .then(() => {
    if (failed > 0) {
      process.exit(1);
    }
    process.stdout.write(`\nModal confirm with checkbox: ${passed} passed\n`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
