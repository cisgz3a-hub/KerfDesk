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
  it('submits all cut-planner policies and synchronizes the legacy flag', async () => {
    const { host, root, onApply } = await renderDialog();
    try {
      expect(host.textContent).toContain('Cut Planner');
      const travelPolicy = host.querySelector('select[name="travelPolicy"]');
      if (!(travelPolicy instanceof HTMLSelectElement)) {
        throw new Error('travel policy missing');
      }
      expect(travelPolicy.value).toBe('nearest-neighbor');

      await act(async () => {
        travelPolicy.value = 'source-order';
        Simulate.change(travelPolicy);
      });
      await act(async () => {
        const form = host.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
        Simulate.submit(form);
      });

      expect(onApply).toHaveBeenCalledWith({
        ...DEFAULT_PROJECT_OPTIMIZATION,
        reduceTravelMoves: false,
        travelPolicy: 'source-order',
      });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
