import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeneratorDialog } from './BoxGeneratorDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderedDialog = {
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onCancel: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('BoxGeneratorDialog draft persistence', () => {
  it.each(['Cancel', 'Escape'] as const)('persists the current draft on %s', async (action) => {
    const first = await renderDialog();
    try {
      await setWidth(first.host, '80');
      await closeDialog(first.host, action);
      expect(first.onCancel).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => first.root.unmount());
    }

    const second = await renderDialog();
    try {
      expect(widthInput(second.host).value).toBe('80');
    } finally {
      await act(async () => second.root.unmount());
    }
  });
});

async function renderDialog(): Promise<RenderedDialog> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onCancel = vi.fn();
  await act(async () => {
    root.render(
      <BoxGeneratorDialog machine={{ kind: 'laser' }} onCancel={onCancel} onGenerate={vi.fn()} />,
    );
  });
  return { host, root, onCancel };
}

async function setWidth(host: HTMLElement, value: string): Promise<void> {
  const input = widthInput(host);
  input.value = value;
  await act(async () => {
    Simulate.change(input);
  });
}

async function closeDialog(host: HTMLElement, action: 'Cancel' | 'Escape'): Promise<void> {
  await act(async () => {
    if (action === 'Escape') {
      host
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Cancel',
    );
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function widthInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('input[aria-label="Width"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Width input missing');
  return input;
}
