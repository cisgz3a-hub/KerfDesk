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

  it('Basic hides Feed but keeps Material + Cut depth', async () => {
    const layer = profileLayer();
    installProject(layer, false);
    useUiStore.getState().setShowCncAdvanced(false);
    const { host, root } = await render(layer);
    try {
      expect(host.querySelector(`input[aria-label="Feed for ${layer.color}"]`)).toBeNull();
      expect(host.querySelector(`select[aria-label="Material for ${layer.color}"]`)).not.toBeNull();
      expect(host.querySelector(`input[aria-label="Cut depth for ${layer.color}"]`)).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('Advanced reveals Feed', async () => {
    const layer = profileLayer();
    installProject(layer, false);
    useUiStore.getState().setShowCncAdvanced(true);
    const { host, root } = await render(layer);
    try {
      expect(host.querySelector(`input[aria-label="Feed for ${layer.color}"]`)).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('the Through cut button sets depth to the stock thickness', async () => {
    const layer = profileLayer();
    installProject(layer, false); // default CNC stock thickness = 6.35 mm
    const { host, root } = await render(layer);
    try {
      const button = [...host.querySelectorAll('button')].find((b) =>
        b.textContent?.startsWith('Through cut'),
      );
      if (button === undefined) throw new Error('Through cut button missing');
      await act(async () => button.click());
      expect(useStore.getState().project.scene.layers[0]?.cnc?.depthMm).toBeCloseTo(6.35, 5);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
