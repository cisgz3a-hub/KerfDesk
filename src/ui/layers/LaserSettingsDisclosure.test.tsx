import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene';
import { CutSettingsDialog } from './CutSettingsDialog';
import { LayerRowSettingsFields } from './LayerRowFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('laser settings disclosures', () => {
  it('keeps a pending numeric draft mounted and commits it when options are collapsed', async () => {
    vi.useFakeTimers();
    const layer = createLayer({ id: 'fill', color: '#000000', mode: 'fill' });
    const commit = vi.fn();
    const view = await mount(
      <LayerRowSettingsFields
        layer={layer}
        operationTarget={{ settings: layer, selectedObjectCount: 0, commit }}
      />,
    );
    try {
      const disclosure = required<HTMLDetailsElement>(view.host, 'details');
      const summary = required<HTMLElement>(disclosure, 'summary');
      await act(async () => summary.click());
      expect(disclosure.open).toBe(true);
      const input = required<HTMLInputElement>(view.host, 'input[aria-label^="Hatch spacing"]');
      await act(async () => {
        input.value = '0.35';
        Simulate.change(input);
        summary.click();
      });
      expect(disclosure.open).toBe(false);
      expect(required(view.host, 'input[aria-label^="Hatch spacing"]')).toBe(input);
      expect(input.value).toBe('0.35');
      expect(commit).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(300));
      expect(commit).toHaveBeenCalledExactlyOnceWith({ hatchSpacingMm: 0.35 });
    } finally {
      await view.close();
      vi.useRealTimers();
    }
  });

  it('applies only edited selection fields even when their group is closed', async () => {
    const layer = createLayer({ id: 'line', color: '#000000', mode: 'line' });
    const onApply = vi.fn();
    const view = await mount(
      <CutSettingsDialog
        layer={layer}
        selectionCount={2}
        operationMembershipEditable={false}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );
    try {
      const mode = required<HTMLSelectElement>(view.host, 'select[name="powerMode"]');
      const disclosure = mode.closest('details');
      if (disclosure === null) throw new Error('Power behaviour disclosure missing');
      await act(async () => {
        disclosure.open = true;
        mode.value = 'constant';
        Simulate.change(mode);
        disclosure.open = false;
      });
      const apply = required<HTMLButtonElement>(view.host, 'button[type="submit"]');
      expect(apply.textContent).toBe('Apply settings');
      await act(async () => apply.click());
      expect(onApply).toHaveBeenCalledExactlyOnceWith({ powerMode: 'constant' });
    } finally {
      await view.close();
    }
  });

  it('cancels without applying edits from collapsed groups', async () => {
    const layer = createLayer({ id: 'line', color: '#000000', mode: 'line' });
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const view = await mount(
      <CutSettingsDialog layer={layer} onApply={onApply} onCancel={onCancel} />,
    );
    try {
      const mode = required<HTMLSelectElement>(view.host, 'select[name="powerMode"]');
      await act(async () => {
        mode.value = 'constant';
        Simulate.change(mode);
      });
      const cancel = [...view.host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Cancel',
      );
      if (cancel === undefined) throw new Error('Cancel button missing');
      await act(async () => cancel.click());
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onApply).not.toHaveBeenCalled();
      expect(layer.powerMode).not.toBe('constant');
    } finally {
      await view.close();
    }
  });
});

function required<T extends HTMLElement>(host: HTMLElement, selector: string): T {
  const element = host.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
