import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { SelectedReliefProperties } from './SelectedReliefProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
    targetWidthMm: 100,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

function installProject(machineKind: 'laser' | 'cnc'): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [relief()],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project });
  useStore.getState().setMachineKind(machineKind);
  useStore.getState().selectObject('R1');
}

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SelectedReliefProperties />);
  });
  return { host, root };
}

describe('SelectedReliefProperties', () => {
  it('renders width/depth/background for a selected relief in CNC mode', async () => {
    installProject('cnc');
    const { host, root } = await render();
    try {
      const section = host.querySelector('[aria-label="Relief properties"]');
      expect(section).not.toBeNull();
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(width.value).toBe('100');
      expect(host.textContent).toContain('model.stl');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('commits a depth edit through setReliefParams on blur', async () => {
    installProject('cnc');
    const { host, root } = await render();
    try {
      const depth = host.querySelector('input[aria-label="Relief depth (mm)"]');
      if (!(depth instanceof HTMLInputElement)) throw new Error('depth input missing');
      await act(async () => {
        depth.value = '8';
        Simulate.change(depth);
      });
      await act(async () => {
        Simulate.blur(depth);
      });

      const stored = useStore.getState().project.scene.objects[0];
      expect(stored?.kind === 'relief' && stored.reliefDepthMm).toBe(8);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('commits a background change', async () => {
    installProject('cnc');
    const { host, root } = await render();
    try {
      const select = host.querySelector('select[aria-label="Relief background"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('background select missing');
      await act(async () => {
        select.value = 'top';
        Simulate.change(select);
      });

      const stored = useStore.getState().project.scene.objects[0];
      expect(stored?.kind === 'relief' && stored.emptyCells).toBe('top');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('does not render in laser mode (reliefs are CNC-only geometry)', async () => {
    installProject('laser');
    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Relief properties"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
