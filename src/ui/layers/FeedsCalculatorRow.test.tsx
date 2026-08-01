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
  settings: CncLayerSettings = DEFAULT_CNC_LAYER_SETTINGS,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <FeedsCalculatorRow layer={LAYER} settings={settings} onCommitSettings={onCommitSettings} />,
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
  // Audit 1.20: the panel opened on hardcoded 'plywood-mdf' / 2 flutes whatever
  // the layer's own recipe said, so it previewed - and on Apply committed -
  // another material's numbers under this layer's name.
  it('opens on the layer’s own material recipe rather than the chart default', async () => {
    install4040Cnc();
    const onCommitSettings = vi.fn();
    const { host, root } = await render(onCommitSettings, {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedSource: { kind: 'material-recipe', materialKey: 'hardwood', fluteCount: 3 },
    });
    try {
      await apply(host);
      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next.feedSource).toMatchObject({
        kind: 'material-recipe',
        materialKey: 'hardwood',
        fluteCount: 3,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('applies the central 4040-aware material recipe with provenance', async () => {
    install4040Cnc();
    const onCommitSettings = vi.fn();
    const { host, root } = await render(onCommitSettings);
    try {
      expect(host.textContent).toContain('machine-aware feed 300');
      expect(host.textContent).toContain('plunge 120');
      expect(host.textContent).toContain('0.75 mm/pass');
      await apply(host);

      const next = onCommitSettings.mock.calls[0]?.[0] as CncLayerSettings;
      expect(next).toMatchObject({
        materialKey: 'plywood-mdf',
        feedMmPerMin: 300,
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

  it('starts from the active catalog bit flute count when no recipe exists', async () => {
    install4040Cnc();
    const onCommitSettings = vi.fn();
    const { host, root } = await render(onCommitSettings);
    try {
      await act(async () => {
        useStore.getState().addCustomCncTool({
          name: '3.175 mm single O-flute',
          kind: 'end-mill',
          diameterMm: 3.175,
          family: 'o-flute-upcut',
          fluteCount: 1,
          catalogId: 'o-upcut-0125',
        });
        const toolId = useStore.getState().cncLibrary.customTools[0]?.id;
        if (toolId === undefined) throw new Error('Catalog tool missing');
        useStore.getState().updateCncMachine({ toolId });
      });
      const fluteSelect = host.querySelector('select[aria-label="Bit flute count"]');
      expect(fluteSelect).toHaveProperty('value', '1');
      await apply(host);
      expect(onCommitSettings.mock.calls[0]?.[0]).toMatchObject({
        feedSource: { kind: 'material-recipe', fluteCount: 1 },
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('preserves an explicit flute override across unrelated machine rerenders', async () => {
    install4040Cnc();
    const { host, root } = await render(vi.fn());
    try {
      const fluteSelect = host.querySelector('select[aria-label="Bit flute count"]');
      if (!(fluteSelect instanceof HTMLSelectElement)) throw new Error('Flute select missing');
      await act(async () => {
        fluteSelect.value = '3';
        fluteSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(fluteSelect.value).toBe('3');

      await act(async () => useStore.getState().updateCncMachine({ stock: { thicknessMm: 12 } }));
      expect(fluteSelect.value).toBe('3');
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
        feedMmPerMin: 300,
        plungeMmPerMin: 80,
        spindleRpm: 10_000,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps Apply enabled for a V-bit while disclosing the unchanged rough-guide model', async () => {
    install4040Cnc();
    const onCommitSettings = vi.fn();
    const { host, root } = await render(onCommitSettings, {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: 'vb-90',
    });
    try {
      const applyButton = host.querySelector('button');
      expect(applyButton).toBeInstanceOf(HTMLButtonElement);
      expect((applyButton as HTMLButtonElement).disabled).toBe(false);
      expect(host.textContent).toContain('machine-aware feed 300');
      expect(host.textContent).toContain(
        'V-bit rough guide: the material recipe uses the stored 12.7 mm diameter band.',
      );
      expect(host.textContent).toContain(
        'It does not model the 90° included angle or the cutting width at each depth.',
      );
      expect(host.textContent).toContain("Start with the cutter manufacturer's data");

      await apply(host);
      expect(onCommitSettings.mock.calls[0]?.[0]).toMatchObject({
        feedMmPerMin: 300,
        plungeMmPerMin: 120,
        spindleRpm: 12_000,
        depthPerPassMm: 0.75,
        feedSource: { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 2 },
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
