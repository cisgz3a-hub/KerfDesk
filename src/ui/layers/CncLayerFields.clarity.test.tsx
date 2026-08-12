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
  it('shows setup-owned material and bit read-only before operation fields', async () => {
    installCnc();
    const view = await renderFields();
    try {
      const selectLabels = [...view.host.querySelectorAll('select')].map((select) =>
        select.getAttribute('aria-label'),
      );
      expect(selectLabels.slice(0, 2)).toEqual([
        'Cut type for #000000',
        // ADR-218: the line-art side qualifies the cut type, so it sits
        // directly under it (default cut type is profile-outside → shown).
        'Line art contours for #000000',
      ]);
      expect(view.host.querySelector('select[aria-label="Material for #000000"]')).toBeNull();
      expect(view.host.querySelector('select[aria-label="Bit for #000000"]')).toBeNull();
      expect(view.host.querySelector('button[aria-label^="Material: Manual"]')).not.toBeNull();
      expect(view.host.querySelector('button[aria-label^="Bit:"]')).not.toBeNull();
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('keeps V-carve Detail in the always-visible Advanced section', async () => {
    const layer: Layer = {
      ...LAYER,
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
    };
    installCnc(layer);
    const view = await renderFields(layer);
    try {
      const section = view.host.querySelector('section[aria-label="Advanced cut settings"]');
      expect(section?.textContent).toContain('Advanced');
      expect(
        view.host.querySelector(`input[aria-label="Detail for ${layer.color}"]`),
      ).not.toBeNull();
      expect(view.host.querySelector('input[aria-label="Show advanced cut settings"]')).toBeNull();
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
      expect(alert?.textContent).toContain('Startup Setup tool plan');
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
      expect(view.host.textContent).toContain('Depth follows stroke width');

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
