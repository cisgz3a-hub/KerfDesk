// CncMaterialRow (ADR-111): picking a material auto-fills feeds + records the
// materialKey; picking Custom clears the key; renders nothing in laser mode.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
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

function install4040Cnc(): void {
  useStore.setState({
    project: {
      ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
      scene: { objects: [], layers: [LAYER] },
    },
  });
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
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCommitSettings).toHaveBeenCalledTimes(1);
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next.materialKey).toBe('plywood-mdf');
      expect(next.feedMmPerMin).toBeGreaterThan(0);
      expect(next.plungeMmPerMin).toBeGreaterThan(0);
      expect(next.depthPerPassMm).toBeGreaterThan(0);
      expect(next.feedSource).toEqual({
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 2,
      });
      // A whole-settings commit preserves fields that the material recipe
      // does not own.
      expect(next.depthMm).toBe(DEFAULT_CNC_LAYER_SETTINGS.depthMm);
      expect(next.cutType).toBe(DEFAULT_CNC_LAYER_SETTINGS.cutType);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('falls back to the machine spindle ceiling when the layer spindle is non-finite', async () => {
    installCnc();
    const onCommit = vi.fn();
    const onCommitSettings = vi.fn();
    const settings = { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: Number.NaN };
    const { host, root } = await render(settings, onCommit, onCommitSettings);
    try {
      await act(async () => selectMaterial(host, 'plywood-mdf'));
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCommitSettings).toHaveBeenCalledTimes(1);
      expect(onCommitSettings.mock.calls[0]?.[0]).toMatchObject({
        spindleRpm: 12_000,
        feedSource: { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 2 },
      });
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
      feedSource: {
        kind: 'material-recipe',
        materialKey: 'hardwood',
        fluteCount: 2,
      },
    };
    const { host, root } = await render(withMaterial, onCommit, onCommitSettings);
    try {
      await act(async () => selectMaterial(host, ''));
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCommitSettings).toHaveBeenCalledTimes(1);
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next.materialKey).toBeUndefined();
      expect(next.feedSource).toBeUndefined();
      // Feeds are untouched — only the label clears.
      expect(next.feedMmPerMin).toBe(withMaterial.feedMmPerMin);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('shows the exact persisted starter revision and offers a real Manual option', async () => {
    install4040Cnc();
    const onCommitSettings = vi.fn();
    const automatic: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedSource: {
        kind: 'machine-starter',
        starterId: 'neotronics-4040-shallow-wood-mdf',
        revision: 1,
      },
    };
    const { host, root } = await render(automatic, vi.fn(), onCommitSettings);
    try {
      const optionLabels = [...host.querySelectorAll('option')].map((option) => option.textContent);
      expect(optionLabels).toContain(
        'Neotronics 4040 shallow wood / MDF starter — revision 1 (engineering starter)',
      );
      expect(optionLabels).toContain('Manual — verify feeds');
      expect(host.textContent).toContain('revision 1 is active');
      expect(host.textContent).toContain(
        'Engineering starter — assumes a 3.175 mm 2-flute cutter; verify on this machine.',
      );

      await act(async () => selectMaterial(host, ''));
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next.feedSource).toBeUndefined();
      expect(next.feedMmPerMin).toBe(automatic.feedMmPerMin);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('marks a saved starter as mismatched instead of borrowing the active profile label', async () => {
    installCnc();
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedSource: {
        kind: 'machine-starter',
        starterId: 'neotronics-4040-shallow-wood-mdf',
        revision: 1,
      },
    };
    const { host, root } = await render(settings, vi.fn(), vi.fn());
    try {
      expect(host.textContent).toContain('revision 1 (saved; profile mismatch)');
      expect(host.textContent).toContain('does not match the active profile');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('marks an older persisted starter revision as outdated', async () => {
    install4040Cnc();
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedSource: {
        kind: 'machine-starter',
        starterId: 'neotronics-4040-shallow-wood-mdf',
        revision: 7,
      },
    };
    const { host, root } = await render(settings, vi.fn(), vi.fn());
    try {
      expect(host.textContent).toContain('saved revision 7 (current revision 1)');
      expect(host.textContent).toContain('is outdated');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('describes a material tag without provenance as legacy manual values', async () => {
    installCnc();
    const legacy = { ...DEFAULT_CNC_LAYER_SETTINGS, materialKey: 'plywood-mdf' as const };
    const { host, root } = await render(legacy, vi.fn(), vi.fn());
    try {
      expect(host.textContent).toContain('Saved Plywood / MDF tag is legacy/unscoped');
      expect(host.textContent).toContain('feeds are manual');
      expect(host.textContent).not.toContain('Starting values calculated');
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
