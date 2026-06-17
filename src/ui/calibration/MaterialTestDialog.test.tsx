import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaterialTestDialog } from './MaterialTestDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(
  onGenerate = vi.fn(),
  onCancel = vi.fn(),
): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: typeof onGenerate;
  readonly onCancel: typeof onCancel;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MaterialTestDialog onCancel={onCancel} onGenerate={onGenerate} />);
  });
  return { host, root, onGenerate, onCancel };
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('MaterialTestDialog', () => {
  it('renders grid controls and generates parsed options', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      expect(host.textContent).toContain('Material Test');
      const rows = input(host, 'Rows');
      const speedMax = input(host, 'Max speed');
      await act(async () => {
        rows.value = '2';
        Simulate.change(rows);
        speedMax.value = '3500';
        Simulate.change(speedMax);
      });

      const generate = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Generate'),
      );
      if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
      await act(async () => {
        generate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ rows: 2, speedMax: 3500 }));
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('restores the last generated material test settings', async () => {
    const first = await renderDialog();
    try {
      const rows = input(first.host, 'Rows');
      const speedMax = input(first.host, 'Max speed');
      await act(async () => {
        rows.value = '3';
        Simulate.change(rows);
        speedMax.value = '4200';
        Simulate.change(speedMax);
      });
      await clickGenerate(first.host);
    } finally {
      await act(async () => first.root.unmount());
    }

    const second = await renderDialog();
    try {
      expect(input(second.host, 'Rows').value).toBe('3');
      expect(input(second.host, 'Max speed').value).toBe('4200');
    } finally {
      await act(async () => second.root.unmount());
    }
  });

  // Gained via the kit Dialog migration (ADR-047): the calibration dialogs
  // previously lacked the Escape/focus-trap behavior every other modal had.
  it('closes on Escape', async () => {
    const { host, root, onCancel } = await renderDialog();
    try {
      const backdrop = host.querySelector('[role="dialog"]');
      await act(async () => {
        backdrop?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

async function clickGenerate(host: HTMLElement): Promise<void> {
  const generate = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Generate'),
  );
  if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
  await act(async () => {
    generate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return element;
}
