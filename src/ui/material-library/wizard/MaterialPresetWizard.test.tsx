import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { MaterialPresetWizard } from './MaterialPresetWizard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

async function renderWizard(
  onClose: () => void = vi.fn(),
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<MaterialPresetWizard onClose={onClose} />);
  });
  if (root === null) throw new Error('root missing');
  return { host, root };
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing input: ${label}`);
  return element;
}

function submitButton(host: HTMLElement): HTMLButtonElement {
  const element = host.querySelector('button[type="submit"]');
  if (!(element instanceof HTMLButtonElement)) throw new Error('missing submit button');
  return element;
}

async function setValue(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function submitStep(host: HTMLElement): Promise<void> {
  const form = host.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('missing form');
  await act(async () => {
    Simulate.submit(form);
  });
}

describe('MaterialPresetWizard', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().createLibrary('Shop');
  });

  it('creates a preset by walking every step', async () => {
    const onClose = vi.fn();
    const { host, root } = await renderWizard(onClose);

    await setValue(input(host, 'Material name'), 'Birch plywood');
    await setValue(input(host, 'Material thickness millimeters'), '3');
    await setValue(input(host, 'Preset description'), 'Clean cut');
    await submitStep(host); // identity -> settings
    await submitStep(host); // settings -> details
    await submitStep(host); // details -> review
    await submitStep(host); // review -> save

    const entries = useStore.getState().materialLibrary?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.materialName).toBe('Birch plywood');
    expect(entries[0]?.thicknessMm).toBe(3);
    expect(entries[0]?.recipe.mode).toBe('line');
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the Next button disabled until the identity step is valid', async () => {
    const { host, root } = await renderWizard();
    expect(submitButton(host).disabled).toBe(true);

    await setValue(input(host, 'Material name'), 'Birch');
    await setValue(input(host, 'Material thickness millimeters'), '3');
    await setValue(input(host, 'Preset description'), 'Cut');
    expect(submitButton(host).disabled).toBe(false);

    await act(async () => root.unmount());
    host.remove();
  });
});
