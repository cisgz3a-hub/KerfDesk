// CncLayerFields relief-contract tests (handoff §7.C): Stepover must render
// whenever it actually drives output — pocket layers AND layers carrying
// relief objects — and the card must say which depth field reliefs honor.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Layer,
  type ImportedSvg,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { resetStore } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

function reliefLayer(cutType: 'engrave' | 'pocket'): Layer {
  return {
    ...createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType },
  };
}

function installProject(layer: Layer, withRelief: boolean): void {
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
    targetWidthMm: 100,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: layer.color,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
  const project: Project = {
    ...createProject(),
    scene: { objects: withRelief ? [relief] : [], layers: [layer] },
  };
  useStore.setState({ project });
  useStore.getState().setMachineKind('cnc');
  // Stepover lives in the advanced field group (ADR-111); reveal it.
  useUiStore.getState().setShowCncAdvanced(true);
}

async function render(layer: Layer): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<CncLayerFields layer={layer} />);
  });
  return { host, root };
}

function stepoverInput(host: HTMLElement, color: string): HTMLInputElement | null {
  const input = host.querySelector(`input[aria-label="Stepover for ${color}"]`);
  return input instanceof HTMLInputElement ? input : null;
}

describe('CncLayerFields relief contract', () => {
  it('shows Stepover for a non-pocket layer that carries a relief, plus the depth hint', async () => {
    const layer = reliefLayer('engrave');
    installProject(layer, true);
    const { host, root } = await render(layer);
    try {
      expect(stepoverInput(host, layer.color)).not.toBeNull();
      expect(host.textContent).toContain('total depth comes from the relief');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('hides Stepover for a non-pocket layer without reliefs', async () => {
    const layer = reliefLayer('engrave');
    installProject(layer, false);
    const { host, root } = await render(layer);
    try {
      expect(stepoverInput(host, layer.color)).toBeNull();
      expect(host.textContent).not.toContain('total depth comes from the relief');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps Stepover for pocket layers regardless of reliefs', async () => {
    const layer = reliefLayer('pocket');
    installProject(layer, false);
    const { host, root } = await render(layer);
    try {
      expect(stepoverInput(host, layer.color)).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

describe('CncLayerFields Basic/Advanced (ADR-111)', () => {
  function profileLayer(): Layer {
    return {
      ...createLayer({ id: '#00aa00', color: '#00aa00' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' },
    };
  }

  it('Basic always shows the core cut params + material + cut depth', async () => {
    const layer = profileLayer();
    installProject(layer, false);
    useUiStore.getState().setShowCncAdvanced(false);
    const { host, root } = await render(layer);
    try {
      for (const field of ['Cut depth', 'Depth per pass', 'Feed', 'Plunge', 'Spindle']) {
        expect(
          host.querySelector(`input[aria-label="${field} for ${layer.color}"]`),
        ).not.toBeNull();
      }
      expect(host.querySelector(`select[aria-label="Material for ${layer.color}"]`)).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('Advanced still gates a genuinely-advanced field (Stepover on a pocket layer)', async () => {
    const layer: Layer = {
      ...createLayer({ id: '#00aa00', color: '#00aa00' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' },
    };
    installProject(layer, false);
    useUiStore.getState().setShowCncAdvanced(false);
    const { host, root } = await render(layer);
    try {
      // Core cut params are visible without the toggle...
      expect(host.querySelector(`input[aria-label="Feed for ${layer.color}"]`)).not.toBeNull();
      // ...but Stepover (pocket ring spacing) is still Advanced-only.
      expect(stepoverInput(host, layer.color)).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('shows linked pocket, clearance, spacing, and tabs for an inlay pair', async () => {
    const layer: Layer = {
      ...createLayer({ id: '#00aa00', color: '#00aa00' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'inlay-pair' },
    };
    installProject(layer, false);
    const { host, root } = await render(layer);
    try {
      for (const field of ['Pocket depth', 'Fit clearance', 'Pair spacing']) {
        expect(
          host.querySelector(`input[aria-label="${field} for ${layer.color}"]`),
        ).not.toBeNull();
      }
      expect(
        host.querySelector(`input[aria-label="Holding tabs for ${layer.color}"]`),
      ).not.toBeNull();
      expect(
        host.querySelector(`input[aria-label="Insert depth for ${layer.color}"]`),
      ).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('seeds editable tab handles for one selected profile object and can reset them', async () => {
    const layer: Layer = {
      ...createLayer({ id: '#00aa00', color: '#00aa00' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-outside',
        tabsEnabled: true,
        tabsPerShape: 4,
      },
    };
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'part',
      source: 'part.svg',
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: layer.color,
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
          ],
        },
      ],
    };
    installProject(layer, false);
    useStore.setState((state) => ({
      project: { ...state.project, scene: { objects: [object], layers: [layer] } },
      selectedObjectId: object.id,
    }));
    const { host, root } = await render(layer);
    try {
      const edit = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Edit positions',
      );
      if (!(edit instanceof HTMLButtonElement)) throw new Error('Edit positions missing');
      await act(async () => edit.click());
      expect(useStore.getState().project.scene.objects[0]?.cncTabAnchors).toHaveLength(4);
      expect(useUiStore.getState().toolMode).toEqual({
        kind: 'cnc-tabs',
        layerColor: layer.color,
      });

      const reset = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Reset automatic',
      );
      if (!(reset instanceof HTMLButtonElement)) throw new Error('Reset automatic missing');
      await act(async () => reset.click());
      expect(useStore.getState().project.scene.objects[0]?.cncTabAnchors).toBeUndefined();
      expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('enables pocket helical entry and removes a conflicting along-path ramp', async () => {
    const layer: Layer = {
      ...createLayer({ id: '#00aa00', color: '#00aa00' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'pocket',
        rampEntryDeg: 5,
        pocketRoughToolId: 'em-6350',
      },
    };
    installProject(layer, false);
    const { host, root } = await render(layer);
    try {
      const checkbox = host.querySelector(`input[aria-label="Helical entry for ${layer.color}"]`);
      if (!(checkbox instanceof HTMLInputElement)) throw new Error('Helical entry toggle missing');
      await act(async () => checkbox.click());
      const settings = useStore.getState().project.scene.layers[0]?.cnc;
      expect(settings?.rampEntryDeg).toBeUndefined();
      expect(settings?.pocketRoughToolId).toBeUndefined();
      expect(settings?.helixEntry).toEqual({
        minDiameterMm: 2,
        maxDiameterMm: 8,
        angleDeg: 3,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('selects a larger roughing bit and removes a conflicting helix', async () => {
    const layer: Layer = {
      ...createLayer({ id: '#00aa00', color: '#00aa00' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'pocket',
        toolId: 'em-1588',
        helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
      },
    };
    installProject(layer, false);
    const { host, root } = await render(layer);
    try {
      const select = host.querySelector(
        `select[aria-label="Pocket roughing bit for ${layer.color}"]`,
      );
      if (!(select instanceof HTMLSelectElement)) throw new Error('Roughing bit selector missing');
      await act(async () => {
        select.value = 'em-6350';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const settings = useStore.getState().project.scene.layers[0]?.cnc;
      expect(settings?.pocketRoughToolId).toBe('em-6350');
      expect(settings?.helixEntry).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('the stock-thickness button sets exact measured stock depth without hidden overcut', async () => {
    const layer = profileLayer();
    installProject(layer, false); // default CNC stock thickness = 6.35 mm
    const { host, root } = await render(layer);
    try {
      const button = [...host.querySelectorAll('button')].find((b) =>
        b.textContent?.startsWith('Set to stock thickness'),
      );
      if (button === undefined) throw new Error('Stock-thickness button missing');
      await act(async () => button.click());
      expect(useStore.getState().project.scene.layers[0]?.cnc?.depthMm).toBeCloseTo(6.35, 5);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
