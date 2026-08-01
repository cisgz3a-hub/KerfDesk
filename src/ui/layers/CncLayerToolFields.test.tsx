// LayerBitSelect: swapping the layer's bit recomputes material-driven feeds
// for the new diameter — a material hint must never describe feeds computed
// for a different bit (audit finding #28).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  createLayer,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { LayerBitSelect, VClearToolSelect } from './CncLayerToolFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  resetStore();
});

const LAYER: Layer = createLayer({ id: 'L1', color: '#ff0000' });

function installCnc(): void {
  useStore.setState({ project: { ...createProject(), scene: { objects: [], layers: [LAYER] } } });
  useStore.getState().setMachineKind('cnc');
}

function installMisnamedCustomVBit(): void {
  const project = useStore.getState().project;
  if (project.machine?.kind !== 'cnc') throw new Error('CNC machine missing');
  useStore.setState({
    project: {
      ...project,
      machine: {
        ...project.machine,
        tools: [
          ...project.machine.tools,
          {
            id: 'custom-misnamed-vbit',
            name: '90 degree 3 mm',
            kind: 'v-bit',
            diameterMm: 3.175,
            tipAngleDeg: 90,
          },
        ],
      },
    },
  });
}

async function render(
  settings: CncLayerSettings,
  onCommit: (patch: Partial<CncLayerSettings>) => void,
  onCommitSettings: (next: CncLayerSettings) => void,
): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <LayerBitSelect
        layer={LAYER}
        settings={settings}
        onCommit={onCommit}
        onCommitSettings={onCommitSettings}
      />,
    );
  });
  return { host, root };
}

async function renderClearToolSelect(
  settings: CncLayerSettings = DEFAULT_CNC_LAYER_SETTINGS,
): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <VClearToolSelect
        layer={LAYER}
        settings={settings}
        onCommit={vi.fn()}
        onCommitSettings={vi.fn()}
      />,
    );
  });
  return { host, root };
}

function selectBit(host: HTMLElement, value: string): void {
  const select = host.querySelector('select');
  if (select === null) throw new Error('bit select missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('LayerBitSelect', () => {
  it('shows stored V-bit geometry before a potentially misleading custom name', async () => {
    installCnc();
    installMisnamedCustomVBit();
    const { host, root } = await render(DEFAULT_CNC_LAYER_SETTINGS, vi.fn(), vi.fn());
    try {
      const option = host.querySelector(
        'option[value="custom-misnamed-vbit"]',
      ) as HTMLOptionElement | null;
      expect(option?.textContent).toBe('3.175 mm, 90° V-bit — 90 degree 3 mm');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps a deleted primary bit visible and clears its stale Active-bit fallback cleanly', async () => {
    installCnc();
    useStore
      .getState()
      .addCustomCncTool({ name: 'Deleted primary', kind: 'end-mill', diameterMm: 4 });
    const customId = useStore.getState().cncLibrary.customTools[0]?.id;
    if (customId === undefined) throw new Error('custom bit missing');
    const staleSettings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: customId,
      feedMmPerMin: 777,
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, layers: [{ ...LAYER, cnc: staleSettings }] },
      },
    }));

    useStore.getState().deleteCustomCncTool(customId);
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    expect(machine.tools.some((tool) => tool.id === customId)).toBe(false);
    const retained = useStore.getState().project.scene.layers[0]?.cnc;
    if (retained === undefined) throw new Error('retained layer settings missing');
    expect(retained.toolId).toBe(customId);

    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const { host, root } = await render(retained, onCommit, onCommitSettings);
    try {
      const select = host.querySelector('select');
      const unavailable = host.querySelector(`option[value="${customId}"]`);
      expect(select).toHaveProperty('value', customId);
      expect(unavailable).toBeInstanceOf(HTMLOptionElement);
      expect((unavailable as HTMLOptionElement).disabled).toBe(true);
      expect(unavailable?.textContent).toContain('Current unavailable bit');
      expect(unavailable?.textContent).toContain(customId);

      await act(async () => selectBit(host, ''));
      const { toolId: _removed, ...cleared } = retained;
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCommitSettings).toHaveBeenCalledWith(cleared);
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('recomputes material feeds for the new bit diameter on bit change', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const staleFeed = 111;
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      materialKey: 'plywood-mdf',
      feedSource: {
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 2,
      },
      feedMmPerMin: staleFeed,
    };
    const { host, root } = await render(settings, onCommit, onCommitSettings);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCommitSettings).toHaveBeenCalledTimes(1);
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next.toolId).toBe('em-6350');
      expect(next.feedMmPerMin).toBeGreaterThan(0);
      expect(next.feedMmPerMin).not.toBe(staleFeed);
      expect(next.plungeMmPerMin).toBeGreaterThan(0);
      expect(next.depthPerPassMm).toBeGreaterThan(0);
      expect(next.feedSource).toEqual({
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 2,
      });
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('leaves feeds alone on bit change when no material is set', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const automaticSettings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedSource: {
        kind: 'machine-starter',
        starterId: 'neotronics-4040-safe',
        revision: 1,
      },
    };
    const { host, root } = await render(automaticSettings, onCommit, onCommitSettings);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCommitSettings).toHaveBeenCalledTimes(1);
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next.toolId).toBe('em-6350');
      expect(next.feedMmPerMin).toBe(automaticSettings.feedMmPerMin);
      expect(next.plungeMmPerMin).toBe(automaticSettings.plungeMmPerMin);
      expect(next.spindleRpm).toBe(automaticSettings.spindleRpm);
      expect(next.depthPerPassMm).toBe(automaticSettings.depthPerPassMm);
      expect(next.materialKey).toBeUndefined();
      expect(next.feedSource).toBeUndefined();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringMatching(/feed.*plunge.*RPM.*depth\/pass.*kept.*verify/i),
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('warns when a manual bit change retains the numeric cutting settings', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const manualSettings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedMmPerMin: 777,
      plungeMmPerMin: 123,
      spindleRpm: 10_000,
      depthPerPassMm: 0.4,
    };
    const { host, root } = await render(manualSettings, onCommit, onCommitSettings);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next).toMatchObject({
        toolId: 'em-6350',
        feedMmPerMin: 777,
        plungeMmPerMin: 123,
        spindleRpm: 10_000,
        depthPerPassMm: 0.4,
      });
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringMatching(/kept.*verify/i),
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('does nothing and emits no warning when the selected bit is unchanged', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: 'em-6350',
    };
    const { host, root } = await render(settings, onCommit, onCommitSettings);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCommitSettings).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('pins the implicit Active bit without warning or rewriting feed provenance', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedSource: {
        kind: 'machine-starter',
        starterId: 'neotronics-4040-safe',
        revision: 2,
      },
    };
    const { host, root } = await render(settings, onCommit, onCommitSettings);
    try {
      await act(async () => selectBit(host, 'em-3175'));
      expect(onCommitSettings).toHaveBeenCalledTimes(1);
      expect(onCommitSettings).toHaveBeenCalledWith({ ...settings, toolId: 'em-3175' });
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('uses a catalog bit flute count when recalculating material feeds', async () => {
    installCnc();
    useStore.getState().addCustomCncTool({
      name: '3.175 mm single O-flute',
      kind: 'end-mill',
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    });
    const tool = useStore.getState().cncLibrary.customTools[0];
    if (tool === undefined) throw new Error('catalog tool missing');
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      materialKey: 'plywood-mdf',
      feedSource: {
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 2,
      },
    };
    const { host, root } = await render(settings, onCommit, onCommitSettings);
    try {
      await act(async () => selectBit(host, tool.id));
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next.toolId).toBe(tool.id);
      expect(next.feedSource).toEqual({
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 1,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

describe('VClearToolSelect', () => {
  it('offers only flat end mills for flat-floor clearing', async () => {
    installCnc();
    const { host, root } = await renderClearToolSelect();
    try {
      const optionValues = [...host.querySelectorAll('option')].map((option) => option.value);
      expect(optionValues).toContain('em-3175');
      expect(optionValues).not.toContain('bn-3175');
      expect(optionValues).not.toContain('eng-15');
      expect(optionValues).not.toContain('vb-60');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps a persisted non-flat clearing bit visible but disabled', async () => {
    installCnc();
    const { host, root } = await renderClearToolSelect({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'v-carve',
      vClearToolId: 'bn-3175',
    });
    try {
      const select = host.querySelector('select');
      const invalid = host.querySelector('option[value="bn-3175"]');
      expect(select).toHaveProperty('value', 'bn-3175');
      expect(invalid).toBeInstanceOf(HTMLOptionElement);
      expect((invalid as HTMLOptionElement).disabled).toBe(true);
      expect(invalid?.textContent).toContain('choose a flat end mill');
      expect(invalid?.textContent).toContain('3.175 mm, Ball nose');
      expect(host.querySelector('option[value="bn-1588"]')).toBeNull();
      expect(host.querySelector('option[value="eng-15"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
