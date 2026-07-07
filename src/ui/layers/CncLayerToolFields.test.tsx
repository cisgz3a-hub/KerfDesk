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
import { LayerBitSelect } from './CncLayerToolFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

const LAYER: Layer = createLayer({ id: 'L1', color: '#ff0000' });

function installCnc(): void {
  useStore.setState({ project: { ...createProject(), scene: { objects: [], layers: [LAYER] } } });
  useStore.getState().setMachineKind('cnc');
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

function selectBit(host: HTMLElement, value: string): void {
  const select = host.querySelector('select');
  if (select === null) throw new Error('bit select missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('LayerBitSelect', () => {
  it('recomputes material feeds for the new bit diameter on bit change', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const staleFeed = 111;
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      materialKey: 'plywood-mdf',
      feedMmPerMin: staleFeed,
    };
    const { host, root } = await render(settings, onCommit, onCommitSettings);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(onCommit).toHaveBeenCalledTimes(1);
      const patch = onCommit.mock.calls[0]?.[0] as Partial<CncLayerSettings>;
      expect(patch.toolId).toBe('em-6350');
      expect(patch.feedMmPerMin).toBeGreaterThan(0);
      expect(patch.feedMmPerMin).not.toBe(staleFeed);
      expect(patch.plungeMmPerMin).toBeGreaterThan(0);
      expect(patch.depthPerPassMm).toBeGreaterThan(0);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('leaves feeds alone on bit change when no material is set', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const { host, root } = await render(DEFAULT_CNC_LAYER_SETTINGS, onCommit, onCommitSettings);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit.mock.calls[0]?.[0]).toEqual({ toolId: 'em-6350' });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
