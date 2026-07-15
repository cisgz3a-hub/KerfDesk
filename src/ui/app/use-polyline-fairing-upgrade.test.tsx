import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolyline, polylineToPolylines } from '../../core/shapes';
import {
  createLayer,
  createProject,
  polylineToCurveSubpath,
  type ShapeObject,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import {
  upgradeCurrentProjectPolylineFairing,
  usePolylineFairingUpgrade,
} from './use-polyline-fairing-upgrade';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
let root: Root | undefined;

describe('upgradeCurrentProjectPolylineFairing', () => {
  beforeEach(() => {
    useStore.getState().newProject();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('upgrades the project already open in memory and marks it dirty', () => {
    const pushToast = vi.fn();
    const legacy = legacyPolyline();
    const project = createProject();
    useStore.setState({
      project: {
        ...project,
        scene: {
          objects: [legacy],
          layers: [createLayer({ id: '#000000', color: '#000000' })],
        },
      },
      dirty: false,
    });

    expect(upgradeCurrentProjectPolylineFairing(pushToast)).toBe(1);

    const upgraded = useStore.getState().project.scene.objects[0];
    expect(useStore.getState().dirty).toBe(true);
    if (upgraded?.kind !== 'shape') throw new Error('Expected an upgraded shape.');
    expect(
      upgraded.paths[0]?.curves?.[0]?.segments.every((segment) => segment.kind === 'cubic'),
    ).toBe(true);
    expect(pushToast).toHaveBeenCalledWith('Smoothed 1 existing drawn path.', 'success');
  });

  it('upgrades and marks legacy drawings dirty after a project load completes', async () => {
    host = document.createElement('div');
    document.body.append(host);
    act(() => {
      root = createRoot(host as HTMLDivElement);
      root.render(<FairingUpgradeHarness />);
    });

    const project = createProject();
    await act(async () => {
      useStore.getState().setProject({
        ...project,
        scene: {
          objects: [legacyPolyline()],
          layers: [createLayer({ id: '#000000', color: '#000000' })],
        },
      });
      useStore.getState().markLoaded('legacy.lf');
      await Promise.resolve();
    });

    const upgraded = useStore.getState().project.scene.objects[0];
    if (upgraded?.kind !== 'shape') throw new Error('Expected an upgraded shape.');
    expect(
      upgraded.paths[0]?.curves?.[0]?.segments.every((segment) => segment.kind === 'cubic'),
    ).toBe(true);
    expect(useStore.getState().dirty).toBe(true);
  });
});

function FairingUpgradeHarness(): null {
  usePolylineFairingUpgrade();
  return null;
}

function legacyPolyline(): ShapeObject {
  const points: Vec2[] = Array.from({ length: 13 }, (_, index) => {
    const angle = (index / 12) * Math.PI;
    return { x: 50 + 50 * Math.cos(angle), y: 50 * Math.sin(angle) };
  });
  const spec = { points, closed: false };
  const current = createPolyline({ id: 'legacy', color: '#000000', spec });
  const polylines = polylineToPolylines(spec);
  return {
    ...current,
    paths: [{ color: current.color, polylines, curves: polylines.map(polylineToCurveSubpath) }],
  };
}
