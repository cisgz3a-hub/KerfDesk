import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncBitCatalogPanel } from './CncBitCatalogPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

function installCnc(): void {
  useStore.getState().setMachineKind('cnc');
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
}

async function renderPanel(): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  installCnc();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<CncBitCatalogPanel />));
  return { host, root };
}

async function search(host: HTMLElement, value: string): Promise<void> {
  const input = host.querySelector('input[type="search"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('catalog search missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('CncBitCatalogPanel', () => {
  it('states the operator-matched envelope and automatic-feed boundary', async () => {
    const { host, root } = await renderPanel();
    try {
      expect(host.textContent).toContain('operator-matched nominal cutting envelopes');
      expect(host.textContent).toContain('not each generated size');
      expect(host.textContent).toContain('explicitly single/double O-flute family');
      expect(host.textContent).toContain('evidenced one/two-flute identity is used');
      expect(host.textContent).toContain('verify flute count, feed, and entry strategy');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('labels family, representative-product, and exact-product source scopes', async () => {
    const { host, root } = await renderPanel();
    try {
      await search(host, 'single O-flute upcut');
      expect(sourceLabels(host)).toContain('Family reference');

      await search(host, 'bowl, tray, and dish');
      expect(sourceLabels(host)).toContain('Example product');

      await search(host, '120° nominal V-bit');
      expect(sourceLabels(host)).toContain('Exact product');

      await search(host, 'Amana 51814');
      expect(host.textContent).toContain('O-flute upcut ball-nose');
      expect(sourceLabels(host)).toContain('Exact product');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps unsupported specialty cutters reference-only', async () => {
    const { host, root } = await renderPanel();
    try {
      await search(host, 'dovetail');
      expect(host.textContent).toContain('Dovetail cutters');
      expect(host.textContent).toContain('Reference-only cutter families');
      expect(host.textContent).not.toContain('geometry not yet modeled');
      expect(host.querySelector('button')).toBeNull();
      expect(host.querySelector('a')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('adds a modeled bit once with its family and flute metadata', async () => {
    const { host, root } = await renderPanel();
    const label = 'Add 3.175 mm (1/8") nominal single O-flute upcut end-mill envelope from catalog';
    try {
      await search(host, 'single O-flute upcut');
      const button = host.querySelector(`button[aria-label='${label}']`);
      if (!(button instanceof HTMLButtonElement)) throw new Error('catalog Add button missing');
      await act(async () => button.click());

      expect(useStore.getState().cncLibrary.customTools).toHaveLength(1);
      expect(useStore.getState().cncLibrary.customTools[0]).toMatchObject({
        family: 'o-flute-upcut',
        fluteCount: 1,
        catalogId: 'o-upcut-0125',
      });

      expect(host.textContent).toContain('Saved');
      expect(host.querySelector(`button[aria-label='${label}']`)).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps newly researched hybrid and knife contracts reference-only', async () => {
    const { host, root } = await renderPanel();
    try {
      await search(host, 'Combination drill/thread');
      expect(host.textContent).toContain('Combination drill/thread mills');
      expect(host.textContent).toContain('Reference-only cutter families');
      expect(host.querySelector('button')).toBeNull();

      await search(host, 'Driven rotary-wheel');
      expect(host.textContent).toContain('Driven rotary-wheel knives');
      expect(host.querySelector('button')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

function sourceLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll('details > summary')]
    .map((summary) => summary.textContent?.trim() ?? '')
    .filter((label) => label !== '');
}
