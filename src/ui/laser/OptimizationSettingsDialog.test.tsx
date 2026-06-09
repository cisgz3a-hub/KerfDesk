import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION } from '../../core/scene';
import { OptimizationSettingsDialog } from './OptimizationSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(onApply = vi.fn()): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onApply: typeof onApply;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OptimizationSettingsDialog
        settings={DEFAULT_PROJECT_OPTIMIZATION}
        onCancel={vi.fn()}
        onApply={onApply}
      />,
    );
  });
  return { host, root, onApply };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('OptimizationSettingsDialog', () => {
  it('renders reduce-travel and submits the checkbox state', async () => {
    const { host, root, onApply } = await renderDialog();
    try {
      expect(host.textContent).toContain('Optimization Settings');
      const reduceTravel = host.querySelector('input[name="reduceTravelMoves"]');
      if (!(reduceTravel instanceof HTMLInputElement)) {
        throw new Error('reduce travel checkbox missing');
      }
      expect(reduceTravel.checked).toBe(true);

      await act(async () => {
        reduceTravel.checked = false;
        Simulate.change(reduceTravel);
      });
      await act(async () => {
        const form = host.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
        Simulate.submit(form);
      });

      expect(onApply).toHaveBeenCalledWith({ reduceTravelMoves: false });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
