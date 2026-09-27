import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncTool,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER: Layer = {
  ...createLayer({ id: 'L1', color: '#000000' }),
  cnc: DEFAULT_CNC_LAYER_SETTINGS,
};

afterEach(() => {
  resetStore();
});

function installCnc(layer: Layer = LAYER): void {
  useStore.setState({
    project: { ...createProject(), scene: { objects: [], layers: [layer] } },
  });
  useStore.getState().setMachineKind('cnc');
}

function installCncWithTool(layer: Layer, tool: CncTool): void {
  installCnc(layer);
  useStore.setState((state) => ({
    project: {
      ...state.project,
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, tool],
        toolId: tool.id,
      },
    },
  }));
}

async function renderFields(
  layer: Layer = LAYER,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<CncLayerFields layer={layer} />));
  return { host, root };
}

describe('CNC layer clarity', () => {
  // ADR-431: the cut type leads, then the bit and material, then the numbers.
  it('offers the cut type, bit and material before cutting values', async () => {
    installCnc();
    const view = await renderFields();
    try {
      const selectLabels = [...view.host.querySelectorAll('select')].map((select) =>
        select.getAttribute('aria-label'),
      );
      expect(selectLabels.slice(0, 3)).toEqual([
        'Cut type for #000000',
        'Bit for #000000',
        'Material for #000000',
      ]);
      const material = view.host.querySelector('select[aria-label="Material for #000000"]');
      const depth = view.host.querySelector('input[aria-label="Cut depth for #000000"]');
      expect(
        material !== null &&
          depth !== null &&
          material.compareDocumentPosition(depth) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(view.host.querySelector('button[aria-label^="Material:"]')).toBeNull();
      expect(view.host.querySelector('button[aria-label^="Bit:"]')).toBeNull();
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('folds V-carve detail into a named group that states its value', async () => {
    const layer: Layer = {
      ...LAYER,
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
    };
    installCnc(layer);
    const view = await renderFields(layer);
    try {
      const detail = view.host.querySelector(`input[aria-label="Detail for ${layer.color}"]`);
      const section = detail?.closest('details');
      expect(section?.querySelector('summary > span')?.textContent).toBe('V-carve detail');
      expect(section?.querySelector('.lf-section-badge')?.textContent).toBe('Automatic');
      expect(section?.open).toBe(false);
      expect(view.host.querySelector('section[aria-label="Advanced cut settings"]')).toBeNull();
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('shows the machine RPM ceiling immediately under the requested spindle speed', async () => {
    installCnc();
    useStore.setState((state) => ({
      project: {
        ...state.project,
        machine: {
          ...DEFAULT_CNC_MACHINE_CONFIG,
          params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleMaxRpm: 9000 },
        },
      },
    }));
    const view = await renderFields();
    try {
      const references = view.host.querySelectorAll('button[aria-label^="Machine maximum:"]');
      expect(references).toHaveLength(1);
      const reference = references[0];
      const spindle = view.host.querySelector<HTMLInputElement>(
        'input[aria-label="Spindle speed for #000000"]',
      );
      expect(reference?.getAttribute('aria-label')).toContain('9,000 RPM');
      expect(reference?.closest('details')).toBeNull();
      expect(spindle?.max).toBe('9000');
      expect(spindle?.value).toBe(String(DEFAULT_CNC_LAYER_SETTINGS.spindleRpm));
      expect(reference?.textContent).toBe('Max 9,000');
      expect(spindle?.closest('.lf-cnc-setting-row')?.nextElementSibling).toBe(reference);
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('does not mislabel a modeled flat-tip engraving cutter as incompatible', async () => {
    const layer: Layer = {
      ...LAYER,
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
    };
    installCncWithTool(layer, {
      id: 'flat-engraver',
      name: '90 degree flat engraver',
      kind: 'engraving',
      diameterMm: 2,
      tipAngleDeg: 90,
      tipDiameterMm: 0.4,
    });
    const view = await renderFields(layer);
    try {
      expect(view.host.querySelector('[role="alert"]')).toBeNull();
      expect(view.host.textContent).not.toContain('V-carve needs');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('keeps the layer alert for an engraving cutter without modeled geometry', async () => {
    const layer: Layer = {
      ...LAYER,
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
    };
    installCncWithTool(layer, {
      id: 'unmodeled-engraver',
      name: 'Unmodeled engraver',
      kind: 'engraving',
      diameterMm: 2,
      tipDiameterMm: 0.4,
    });
    const view = await renderFields(layer);
    try {
      const alert = view.host.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('V-carve needs a V-bit or modeled angled engraving bit');
      expect(alert?.textContent).toContain('Choose one under Bit above');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('defaults new V-carves to flowing depth and makes a flat floor explicit', async () => {
    const layer: Layer = {
      ...LAYER,
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
    };
    installCnc(layer);
    const view = await renderFields(layer);
    try {
      const flatDepth = view.host.querySelector<HTMLInputElement>(
        `input[aria-label="Flat depth for ${layer.color}"]`,
      );
      expect(flatDepth).not.toBeNull();
      expect(flatDepth?.checked).toBe(false);
      expect(view.host.textContent).not.toContain('Floor depth');
      expect(flatDepth?.title).toContain('depth follows stroke width');

      await act(async () => flatDepth?.click());
      expect(useStore.getState().project.scene.layers[0]?.cnc?.vCarveFlatDepthEnabled).toBe(true);
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('enters V-carve in flowing-depth mode instead of inheriting a hidden legacy floor', async () => {
    const engraveLayer: Layer = {
      ...LAYER,
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'engrave',
        depthMm: 0.1,
        depthPerPassMm: 0.4,
        vCarveFlatDepthEnabled: true,
      },
    };
    installCnc(engraveLayer);
    const view = await renderFields(engraveLayer);
    try {
      const cutType = view.host.querySelector<HTMLSelectElement>(
        `select[aria-label="Cut type for ${LAYER.color}"]`,
      );
      expect(cutType).not.toBeNull();
      await act(async () => {
        if (cutType === null) return;
        cutType.value = 'v-carve';
        cutType.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(useStore.getState().project.scene.layers[0]?.cnc).toMatchObject({
        cutType: 'v-carve',
        depthMm: 0.1,
        depthPerPassMm: 0.4,
        vCarveFlatDepthEnabled: false,
      });
      const converted = useStore.getState().project.scene.layers[0];
      if (converted === undefined) throw new Error('converted operation missing');
      await act(async () => view.root.render(<CncLayerFields layer={converted} />));
      expect(
        view.host.querySelector(`input[aria-label="Cut depth for ${converted.color}"]`),
      ).toBeNull();
      expect(
        view.host.querySelector(`input[aria-label="Floor depth for ${converted.color}"]`),
      ).toBeNull();
      expect(
        view.host.querySelector<HTMLInputElement>(
          `input[aria-label="Depth per pass for ${converted.color}"]`,
        )?.value,
      ).toBe('0.4');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });
});
