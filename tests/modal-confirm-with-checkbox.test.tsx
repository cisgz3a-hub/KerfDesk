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
(globalThis as any).window = win;
(globalThis as any).document = win.document;
// React 19 scheduler can use rAF
if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number;
}
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

async function mount(): Promise<void> {
  hookStore = { api: null };
  if (root) {
    await act(async () => {
      root!.unmount();
      await flush();
    });
    root = null;
  }
  root = createRoot(container);
  await act(async () => {
    root!.render(React.createElement(CaptureHook));
    await flush();
  });
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
    await act(async () => {
      root!.unmount();
      await flush();
    });
    root = null;
  }
  await flush();
}

async function finishConfirmWithCheckbox(
  api: ModalApi,
  result: { ok: boolean; checkboxChecked: boolean },
): Promise<void> {
  await act(async () => {
    api.finishConfirmWithCheckbox(result);
    await flush();
  });
}

async function dismissModal(api: ModalApi): Promise<void> {
  await act(async () => {
    api.dismissModal();
    await flush();
  });
}

async function showConfirmWithCheckboxModal(
  api: ModalApi,
  title: string,
  message: string,
  checkboxLabel: string,
  details?: string,
): Promise<{ promise: Promise<{ ok: boolean; checkboxChecked: boolean }> }> {
  let result: Promise<{ ok: boolean; checkboxChecked: boolean }> | null = null;
  await act(async () => {
    result = api.showConfirmWithCheckbox(title, message, checkboxLabel, details);
    await flush();
  });
  return { promise: result! };
}

async function main(): Promise<void> {
  console.log('\n=== useModal: confirmWithCheckbox — OK, checkbox on ===');
  {
    await mount();
    const api = await getApi();
    const { promise: p } = await showConfirmWithCheckboxModal(api, 'T', 'M', "Don't", 'D');
    await finishConfirmWithCheckbox(api, { ok: true, checkboxChecked: true });
    const r = await p;
    assert(r.ok === true && r.checkboxChecked === true, 'OK with checkbox on');
    await unmountAll();
  }

  console.log('\n=== useModal: confirmWithCheckbox — OK, checkbox off ===');
  {
    await mount();
    const api = await getApi();
    const { promise: p } = await showConfirmWithCheckboxModal(api, 'T2', 'M2', "Don't 2");
    await flush();
    await finishConfirmWithCheckbox(api, { ok: true, checkboxChecked: false });
    const r = await p;
    assert(r.ok === true && r.checkboxChecked === false, 'OK without checkbox');
    await unmountAll();
  }

  console.log('\n=== useModal: confirmWithCheckbox — cancel via finish ===');
  {
    await mount();
    const api = await getApi();
    const { promise: p } = await showConfirmWithCheckboxModal(api, 'T3', 'M3', "Don't 3");
    await flush();
    await finishConfirmWithCheckbox(api, { ok: false, checkboxChecked: false });
    const r = await p;
    assert(r.ok === false && r.checkboxChecked === false, 'Explicit cancel result');
    await unmountAll();
  }

  console.log('\n=== useModal: confirmWithCheckbox — dismissModal ===');
  {
    await mount();
    const api = await getApi();
    const { promise: p } = await showConfirmWithCheckboxModal(api, 'T4', 'M4', "Don't 4");
    await flush();
    await dismissModal(api);
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
