// CncMaterialRow (ADR-106): picking a material auto-fills feeds + records the
// materialKey; picking Custom clears the key; renders nothing in laser mode.

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
import { CncMaterialRow } from './CncMaterialRow';

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
      <CncMaterialRow
        layer={LAYER}
        settings={settings}
        onCommit={onCommit}
        onCommitSettings={onCommitSettings}
      />,
    );
  });
  return { host, root };
}

function selectMaterial(host: HTMLElement, value: string): void {
  const select = host.querySelector('select');
  if (select === null) throw new Error('material select missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('CncMaterialRow', () => {
  it('auto-fills feeds and records the material on pick', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const { host, root } = await render(DEFAULT_CNC_LAYER_SETTINGS, onCommit, onCommitSettings);
    try {
      await act(async () => selectMaterial(host, 'plywood-mdf'));
      expect(onCommit).toHaveBeenCalledTimes(1);
      const patch = onCommit.mock.calls[0]?.[0] as Partial<CncLayerSettings>;
      expect(patch.materialKey).toBe('plywood-mdf');
      expect(patch.feedMmPerMin).toBeGreaterThan(0);
      expect(patch.plungeMmPerMin).toBeGreaterThan(0);
      expect(patch.depthPerPassMm).toBeGreaterThan(0);
      // Cut type / depth are NOT touched by the material pick.
      expect(patch.depthMm).toBeUndefined();
      expect(patch.cutType).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('clears the material key on Custom via a whole-settings commit', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const withMaterial: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      materialKey: 'hardwood',
    };
    const { host, root } = await render(withMaterial, onCommit, onCommitSettings);
    try {
      await act(async () => selectMaterial(host, ''));
      expect(onCommitSettings).toHaveBeenCalledTimes(1);
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next.materialKey).toBeUndefined();
      // Feeds are untouched — only the label clears.
      expect(next.feedMmPerMin).toBe(withMaterial.feedMmPerMin);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('renders nothing in laser mode', async () => {
    resetStore(); // laser by default
    const { host, root } = await render(DEFAULT_CNC_LAYER_SETTINGS, vi.fn(), vi.fn());
    try {
      expect(host.querySelector('select')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
