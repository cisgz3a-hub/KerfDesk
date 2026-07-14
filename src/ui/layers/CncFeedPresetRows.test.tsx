import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncFeedPresetRows } from './CncFeedPresetRows';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER = createLayer({ id: 'L1', color: '#000000' });

afterEach(() => resetStore());

async function renderRows(
  onCommit: (patch: Partial<typeof DEFAULT_CNC_LAYER_SETTINGS>) => void = vi.fn(),
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <CncFeedPresetRows layer={LAYER} settings={DEFAULT_CNC_LAYER_SETTINGS} onCommit={onCommit} />,
    );
  });
  return { host, root };
}

function typeName(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CncFeedPresetRows', () => {
  it('shows an honest empty state and disables saving until a name exists', async () => {
    useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
    const view = await renderRows();
    try {
      const select = view.host.querySelector('select[aria-label="Apply feeds preset for #000000"]');
      const input = view.host.querySelector(
        'input[aria-label="New feeds preset name for #000000"]',
      );
      const save = view.host.querySelector('button[aria-label="Save feeds preset for #000000"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Preset select missing');
      if (!(input instanceof HTMLInputElement)) throw new Error('Preset name input missing');
      if (!(save instanceof HTMLButtonElement)) throw new Error('Preset save button missing');

      expect(select.disabled).toBe(true);
      expect(select.textContent).toContain('No saved presets');
      expect(save.disabled).toBe(true);
      expect(input.parentElement?.style.flexWrap).toBe('wrap');

      await act(async () => typeName(input, 'Ply rough'));
      expect(save.disabled).toBe(false);
      await act(async () => save.click());
      expect(useStore.getState().cncLibrary.feedPresets[0]?.name).toBe('Ply rough');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('applies an existing preset through the redesigned selector', async () => {
    useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
    useStore.getState().saveCncFeedPreset('Ply finish', {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedMmPerMin: 876,
    });
    const preset = useStore.getState().cncLibrary.feedPresets[0];
    if (preset === undefined) throw new Error('Preset setup failed');
    const onCommit = vi.fn();
    const view = await renderRows(onCommit);
    try {
      const select = view.host.querySelector('select[aria-label="Apply feeds preset for #000000"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Preset select missing');

      await act(async () => {
        select.value = preset.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });

      expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ feedMmPerMin: 876 }));
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });
});
