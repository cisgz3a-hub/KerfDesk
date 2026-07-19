import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { FeedsCalculatorRow } from './FeedsCalculatorRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER: Layer = createLayer({ id: 'calculator-layer', color: '#bb5500' });

afterEach(resetStore);

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
  onCommitSettings: (settings: CncLayerSettings) => void,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <FeedsCalculatorRow
        layer={LAYER}
        settings={DEFAULT_CNC_LAYER_SETTINGS}
        onCommitSettings={onCommitSettings}
      />,
    );
  });
  return { host, root };
}

async function apply(host: HTMLElement): Promise<void> {
  const button = host.querySelector('button');
  if (button === null) throw new Error('Apply to layer button missing');
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('FeedsCalculatorRow', () => {
  it('applies the central 4040-aware material recipe with provenance', async () => {
    install4040Cnc();
    const onCommitSettings = vi.fn();
    const { host, root } = await render(onCommitSettings);
    try {
      expect(host.textContent).toContain('machine-aware feed 600');
      expect(host.textContent).toContain('plunge 120');
      expect(host.textContent).toContain('0.75 mm/pass');
      await apply(host);

      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next).toMatchObject({
        materialKey: 'plywood-mdf',
        feedMmPerMin: 600,
        plungeMmPerMin: 120,
        spindleRpm: 12_000,
        depthPerPassMm: 0.75,
        feedSource: {
          kind: 'material-recipe',
          materialKey: 'plywood-mdf',
          fluteCount: 2,
        },
      });
      expect(next.cutType).toBe(DEFAULT_CNC_LAYER_SETTINGS.cutType);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('includes connected controller caps in the applied recipe', async () => {
    install4040Cnc();
    useStore.getState().setCncLiveCaps({
      xMaxFeedMmPerMin: 500,
      yMaxFeedMmPerMin: 450,
      zMaxFeedMmPerMin: 80,
      spindleMaxRpm: 10_000,
    });
    const onCommitSettings = vi.fn();
    const { host, root } = await render(onCommitSettings);
    try {
      await apply(host);
      expect(onCommitSettings.mock.calls[0]?.[0]).toMatchObject({
        feedMmPerMin: 450,
        plungeMmPerMin: 80,
        spindleRpm: 10_000,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('uses the compile-authoritative CNC machine spindle ceiling', async () => {
    install4040Cnc();
    const project = useStore.getState().project;
    if (project.machine?.kind !== 'cnc') throw new Error('CNC setup missing');
    useStore.setState({
      project: {
        ...project,
        machine: {
          ...project.machine,
          params: { ...project.machine.params, spindleMaxRpm: 9_000 },
        },
      },
    });
    const onCommitSettings = vi.fn();
    const { host, root } = await render(onCommitSettings);
    try {
      await apply(host);
      expect(onCommitSettings.mock.calls[0]?.[0]).toMatchObject({ spindleRpm: 9_000 });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
