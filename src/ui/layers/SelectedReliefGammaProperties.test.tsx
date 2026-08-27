import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
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
  vi.useRealTimers();
});

function depthRelief(gamma = 1, id = 'R1'): ReliefObject {
  return {
    kind: 'relief',
    id,
    source: 'depth.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      mapping: { curve: { kind: 'gamma-v1', gamma } },
      provenance: { sourceName: 'depth.png' },
    }),
    targetWidthMm: 100,
    reliefDepthMm: 5,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

function installProject(object: ReliefObject = depthRelief()): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [object],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project });
  useStore.getState().setMachineKind('cnc');
  useStore.getState().selectObject('R1');
}

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<SelectedReliefProperties />));
  return { host, root };
}

describe('SelectedReliefProperties gamma control', () => {
  it('shows uncapped gamma after polarity and before input levels', async () => {
    installProject();
    const beforeProject = useStore.getState().project;
    const beforeUndoStack = useStore.getState().undoStack;
    const beforeDirty = useStore.getState().dirty;
    const { host, root } = await render();
    try {
      expect(host.querySelector('select[aria-label="Relief background"]')).toBeNull();
      const polarity = host.querySelector('select[aria-label="Relief height-map polarity"]');
      const levels = host.querySelector('[aria-label="Relief input levels"]');
      const gamma = host.querySelector('input[aria-label="Relief gamma"]');
      if (!(polarity instanceof HTMLSelectElement)) throw new Error('polarity select missing');
      if (!(levels instanceof HTMLDivElement)) throw new Error('input levels missing');
      if (!(gamma instanceof HTMLInputElement)) throw new Error('gamma input missing');
      expect(gamma).toMatchObject({ value: '1', min: '', max: '' });
      expect(polarity.closest('label')?.nextElementSibling).toBe(gamma.closest('label'));
      expect(gamma.closest('label')?.nextElementSibling).toBe(levels);
      expect(useStore.getState()).toMatchObject({
        project: beforeProject,
        undoStack: beforeUndoStack,
        dirty: beforeDirty,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('commits an uncapped positive gamma exactly', async () => {
    installProject();
    const { host, root } = await render();
    try {
      const gamma = host.querySelector('input[aria-label="Relief gamma"]');
      if (!(gamma instanceof HTMLInputElement)) throw new Error('gamma input missing');
      await act(async () => {
        gamma.value = '123456.75';
        Simulate.change(gamma);
      });
      await act(async () => Simulate.blur(gamma));
      const stored = useStore.getState().project.scene.objects[0];
      expect(
        stored?.kind === 'relief' && stored.reliefSource.kind === 'heightfield-v1'
          ? stored.reliefSource.mapping.curve.gamma
          : null,
      ).toBe(123456.75);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('restores the canonical gamma after a non-positive draft without mutating state', async () => {
    installProject(depthRelief(1.25));
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });
    const before = useStore.getState().project;
    const { host, root } = await render();
    try {
      const gamma = host.querySelector('input[aria-label="Relief gamma"]');
      if (!(gamma instanceof HTMLInputElement)) throw new Error('gamma input missing');
      await act(async () => {
        gamma.value = '0';
        Simulate.change(gamma);
      });
      await act(async () => Simulate.blur(gamma));
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState()).toMatchObject({ dirty: false, undoStack: [] });
      expect(gamma.value).toBe('1.25');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('cancels a pending gamma edit when selection changes', async () => {
    vi.useFakeTimers();
    installProject();
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        scene: { ...project.scene, objects: [depthRelief(1, 'R1'), depthRelief(2, 'R2')] },
      },
    });
    const { host, root } = await render();
    try {
      const gamma = host.querySelector('input[aria-label="Relief gamma"]');
      if (!(gamma instanceof HTMLInputElement)) throw new Error('gamma input missing');
      await act(async () => {
        gamma.value = '4';
        Simulate.change(gamma);
      });
      await act(async () => useStore.getState().selectObject('R2'));
      await act(async () => vi.advanceTimersByTime(350));
      const values = useStore
        .getState()
        .project.scene.objects.filter(
          (object): object is Extract<ReliefObject, { kind: 'relief' }> => object.kind === 'relief',
        )
        .map((object) =>
          object.reliefSource.kind === 'heightfield-v1'
            ? object.reliefSource.mapping.curve.gamma
            : null,
        );
      expect(values).toEqual([1, 2]);
      const refreshed = host.querySelector('input[aria-label="Relief gamma"]');
      expect(refreshed instanceof HTMLInputElement ? refreshed.value : null).toBe('2');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
