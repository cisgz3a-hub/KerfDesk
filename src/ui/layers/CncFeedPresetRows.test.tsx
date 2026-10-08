import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CNC_CONTEXT_PRESET, CNC_CONTEXT_TOOL } from '../../__fixtures__/cnc-cutting-preset';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncLayerSettings,
} from '../../core/scene';
import { cncCuttingValues } from '../../core/cnc/cutting-preset';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncFeedPresetRows } from './CncFeedPresetRows';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const LAYER = createLayer({ id: 'L1', color: '#000000' });
const SETTINGS: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  ...cncCuttingValues(CNC_CONTEXT_PRESET),
  materialKey: 'plywood-mdf',
};
beforeEach(() => {
  resetStore();
  useStore.setState((state) => ({
    cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] },
    project: {
      ...state.project,
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tools: [CNC_CONTEXT_TOOL],
        toolId: CNC_CONTEXT_TOOL.id,
        params: {
          ...DEFAULT_CNC_MACHINE_CONFIG.params,
          spindleMaxRpm: 24000,
          maxFeedMmPerMin: 3000,
        },
      },
      device: {
        ...state.project.device,
        profileId: 'router-a',
        name: 'Shop router',
        controllerKind: 'grbl-v1.1',
        maxFeed: 3000,
      },
    },
  }));
});
afterEach(() => resetStore());

async function renderRows(
  settings = SETTINGS,
  onCommit: (patch: Partial<CncLayerSettings>) => void = vi.fn(),
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<CncFeedPresetRows layer={LAYER} settings={settings} onCommit={onCommit} />),
  );
  return { host, root };
}
async function dispose(view: { readonly host: HTMLElement; readonly root: Root }): Promise<void> {
  await act(async () => view.root.unmount());
  view.host.remove();
}
function inputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function selectValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
function presetSelector(host: HTMLElement): HTMLSelectElement {
  const select = host.querySelector('select[aria-label="Apply feeds preset for #000000"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('Preset selector missing');
  return select;
}
function applyButton(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector('button[aria-label="Apply reviewed feeds preset for #000000"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Reviewed Apply missing');
  return button;
}
function installPreset(): void {
  useStore.setState((s) => ({
    cncLibrary: { ...s.cncLibrary, feedPresets: [CNC_CONTEXT_PRESET] },
  }));
}

describe('CncFeedPresetRows', () => {
  it('saves current tool/material/machine context with unit-stable values and unverified evidence', async () => {
    const view = await renderRows();
    try {
      expect(presetSelector(view.host).disabled).toBe(true);
      const input = view.host.querySelector(
        'input[aria-label="New feeds preset name for #000000"]',
      );
      const save = view.host.querySelector('button[aria-label="Save feeds preset for #000000"]');
      if (!(input instanceof HTMLInputElement) || !(save instanceof HTMLButtonElement))
        throw new Error('Save fields missing');
      expect(save.disabled).toBe(true);
      await act(async () => inputValue(input, 'Ply rough'));
      expect(save.disabled).toBe(false);
      await act(async () => save.click());
      const saved = useStore.getState().cncLibrary.feedPresets[0];
      expect(saved?.context).toEqual(CNC_CONTEXT_PRESET.context);
      expect(saved?.units).toBe('mm-min-rpm');
      expect(saved?.qualification?.status).toBe('unverified');
      expect(saved?.name).toBe('Ply rough');
    } finally {
      await dispose(view);
    }
  });
  it('saves generic manual values without material and requires review before applying them', async () => {
    const settings = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 1200 };
    const commit = vi.fn();
    const view = await renderRows(settings, commit);
    try {
      const input = view.host.querySelector(
        'input[aria-label="New feeds preset name for #000000"]',
      );
      const save = view.host.querySelector('button[aria-label="Save feeds preset for #000000"]');
      if (!(input instanceof HTMLInputElement) || !(save instanceof HTMLButtonElement))
        throw new Error('Save fields missing');
      await act(async () => inputValue(input, 'Birch test feed'));
      expect(save.disabled).toBe(false);
      expect(view.host.textContent).toContain('generic, unverified record');
      await act(async () => save.click());
      const saved = useStore.getState().cncLibrary.feedPresets[0];
      expect(saved).toMatchObject({
        ...cncCuttingValues(settings),
        name: 'Birch test feed',
        units: 'mm-min-rpm',
        qualification: { status: 'unverified', notes: '' },
      });
      expect(saved).not.toHaveProperty('context');
      if (saved === undefined) throw new Error('Generic record missing');
      await act(async () => selectValue(presetSelector(view.host), saved.id));
      expect(view.host.textContent).toContain('Unbound cutting record');
      expect(applyButton(view.host).disabled).toBe(true);
      expect(commit).not.toHaveBeenCalled();
      const acknowledge = view.host.querySelector('input[type="checkbox"]');
      if (!(acknowledge instanceof HTMLInputElement))
        throw new Error('Unknown-context review missing');
      await act(async () => acknowledge.click());
      await act(async () => applyButton(view.host).click());
      expect(commit).toHaveBeenCalledExactlyOnceWith({
        ...cncCuttingValues(settings),
        cuttingPreset: saved,
      });
    } finally {
      await dispose(view);
    }
  });
  it('previews compatible differences before a deliberate Apply', async () => {
    installPreset();
    const commit = vi.fn();
    const view = await renderRows({ ...SETTINGS, feedMmPerMin: 900 }, commit);
    try {
      await act(async () => selectValue(presetSelector(view.host), CNC_CONTEXT_PRESET.id));
      expect(commit).not.toHaveBeenCalled();
      expect(
        view.host.querySelector('table[aria-label="Cutting value differences"]')?.textContent,
      ).toContain('900');
      expect(applyButton(view.host).disabled).toBe(false);
      await act(async () => applyButton(view.host).click());
      expect(commit).toHaveBeenCalledWith(
        expect.objectContaining({ feedMmPerMin: 800, cuttingPreset: CNC_CONTEXT_PRESET }),
      );
      expect(commit.mock.calls[0]?.[0]).not.toHaveProperty('toolId');
    } finally {
      await dispose(view);
    }
  });
  it('never silently copies plywood data into a metal context and revokes stale acknowledgement', async () => {
    installPreset();
    const commit = vi.fn();
    const view = await renderRows({ ...SETTINGS, materialKey: 'aluminium' }, commit);
    try {
      await act(async () => selectValue(presetSelector(view.host), CNC_CONTEXT_PRESET.id));
      expect(applyButton(view.host).disabled).toBe(true);
      expect(view.host.textContent).toContain('Material differs');
      const acknowledge = view.host.querySelector('input[type="checkbox"]');
      if (!(acknowledge instanceof HTMLInputElement))
        throw new Error('Context acknowledgement missing');
      await act(async () => acknowledge.click());
      expect(applyButton(view.host).disabled).toBe(false);
      await act(async () =>
        useStore.setState((state) => ({
          project: { ...state.project, device: { ...state.project.device, name: 'Other machine' } },
        })),
      );
      expect(applyButton(view.host).disabled).toBe(true);
      expect(commit).not.toHaveBeenCalled();
    } finally {
      await dispose(view);
    }
  });
  it('keeps a job snapshot visible after library deletion and shows explicit overrides', async () => {
    const view = await renderRows({
      ...SETTINGS,
      feedMmPerMin: 950,
      cuttingPreset: CNC_CONTEXT_PRESET,
    });
    try {
      expect(view.host.textContent).toContain('Saved cutting record: Plywood roughing');
      expect(view.host.textContent).toContain('1 job overrides');
      expect(view.host.textContent).toContain(
        'Library changes and deletion do not change its values',
      );
      expect(view.host.querySelector('table')?.textContent).toContain('950');
      expect(useStore.getState().cncLibrary.feedPresets).toHaveLength(0);
    } finally {
      await dispose(view);
    }
  });
  it('discloses unbound legacy records and requires review before one-time application', async () => {
    const { context: _context, ...legacy } = CNC_CONTEXT_PRESET;
    useStore.setState((s) => ({ cncLibrary: { ...s.cncLibrary, feedPresets: [legacy] } }));
    const commit = vi.fn();
    const view = await renderRows(SETTINGS, commit);
    try {
      await act(async () => selectValue(presetSelector(view.host), legacy.id));
      expect(view.host.textContent).toContain('Unbound cutting record');
      expect(applyButton(view.host).disabled).toBe(true);
      expect(commit).not.toHaveBeenCalled();
    } finally {
      await dispose(view);
    }
  });
});
