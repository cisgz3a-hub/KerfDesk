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
});

function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
      emptyCells: 'floor',
    },
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

function depthRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'depth.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      provenance: { sourceName: 'depth.png' },
    }),
    targetWidthMm: 100,
    reliefDepthMm: 5,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

function installProject(machineKind: 'laser' | 'cnc', object: ReliefObject = relief()): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [object],
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
      const depth = host.querySelector('input[aria-label="Relief depth (mm)"]');
      if (!(depth instanceof HTMLInputElement)) throw new Error('depth input missing');
      expect(width.value).toBe('100');
      expect(width.min).toBe('');
      expect(width.max).toBe('');
      expect(depth.min).toBe('');
      expect(depth.max).toBe('');
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
        depth.value = '0.05';
        Simulate.change(depth);
      });
      await act(async () => {
        Simulate.blur(depth);
      });

      const stored = useStore.getState().project.scene.objects[0];
      expect(stored?.kind === 'relief' && stored.reliefDepthMm).toBe(0.05);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('reports and edits physical width without rewriting an untouched rounded value', async () => {
    const object = {
      ...depthRelief(),
      transform: { ...IDENTITY_TRANSFORM, scaleX: 0.36, scaleY: 2 },
    };
    installProject('cnc', object);
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(width.value).toBe('36');
      expect(width.min).toBe('');
      expect(width.max).toBe('');
      expect(width.title).toMatch(/local X axis.*current Y scale/i);

      await act(async () => Simulate.blur(width));
      let stored = useStore.getState().project.scene.objects[0];
      if (stored?.kind !== 'relief') throw new Error('relief missing');
      expect(stored.targetWidthMm).toBe(100);
      expect(stored.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
      expect(useStore.getState().dirty).toBe(false);
      expect(useStore.getState().undoStack).toHaveLength(0);

      await act(async () => {
        width.value = '720';
        Simulate.change(width);
      });
      await act(async () => Simulate.blur(width));
      stored = useStore.getState().project.scene.objects[0];
      if (stored?.kind !== 'relief') throw new Error('relief missing');
      expect(stored.targetWidthMm).toBe(2000);
      expect(stored.targetWidthMm * Math.abs(stored.transform.scaleX)).toBe(720);
      expect(stored.bounds).toEqual({ minX: 0, minY: 0, maxX: 2000, maxY: 1000 });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('does not round-trip an untouched physical width back into authored bounds', async () => {
    const object = {
      ...depthRelief(),
      transform: { ...IDENTITY_TRANSFORM, scaleX: 1 / 3 },
    };
    installProject('cnc', object);
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(width.value).toBe('33.333333');
      await act(async () => Simulate.blur(width));

      const stored = useStore.getState().project.scene.objects[0];
      if (stored?.kind !== 'relief') throw new Error('relief missing');
      expect(stored.targetWidthMm).toBe(100);
      expect(stored.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
      expect(useStore.getState().dirty).toBe(false);
      expect(useStore.getState().undoStack).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it.each([
    { name: 'negative', scaleX: -2, initial: '200', edited: '300', targetWidthMm: 150 },
    { name: 'legacy zero', scaleX: 0, initial: '100', edited: '125', targetWidthMm: 125 },
  ])('keeps $name X scale semantics while editing physical width', async (fixture) => {
    const object = {
      ...depthRelief(),
      transform: { ...IDENTITY_TRANSFORM, scaleX: fixture.scaleX },
    };
    installProject('cnc', object);
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(width.value).toBe(fixture.initial);
      await act(async () => {
        width.value = fixture.edited;
        Simulate.change(width);
      });
      await act(async () => Simulate.blur(width));

      const stored = useStore.getState().project.scene.objects[0];
      if (stored?.kind !== 'relief') throw new Error('relief missing');
      expect(stored.targetWidthMm).toBe(fixture.targetWidthMm);
      expect(stored.transform.scaleX).toBe(fixture.scaleX);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('cancels a pending width commit when an external resize changes scale', async () => {
    vi.useFakeTimers();
    installProject('cnc', depthRelief());
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      await act(async () => {
        width.value = '125';
        Simulate.change(width);
      });
      const object = useStore.getState().project.scene.objects[0];
      if (object?.kind !== 'relief') throw new Error('relief missing');
      await act(async () =>
        useStore
          .getState()
          .applySelectionTransforms([
            { id: object.id, transform: { ...object.transform, scaleX: 2 } },
          ]),
      );
      await act(async () => vi.advanceTimersByTime(350));

      const stored = useStore.getState().project.scene.objects[0];
      if (stored?.kind !== 'relief') throw new Error('relief missing');
      expect(stored.targetWidthMm).toBe(100);
      expect(stored.transform.scaleX).toBe(2);
      const refreshed = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(refreshed instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(refreshed.value).toBe('200');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it('cancels a pending width commit when authored width changes externally', async () => {
    vi.useFakeTimers();
    installProject('cnc', depthRelief());
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      await act(async () => {
        width.value = '125';
        Simulate.change(width);
      });
      await act(async () => useStore.getState().setReliefParams('R1', { targetWidthMm: 140 }));
      await act(async () => vi.advanceTimersByTime(350));

      const stored = useStore.getState().project.scene.objects[0];
      expect(stored?.kind === 'relief' ? stored.targetWidthMm : null).toBe(140);
      const refreshed = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(refreshed instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(refreshed.value).toBe('140');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it('cancels a pending edit when a new document reuses the relief id', async () => {
    vi.useFakeTimers();
    installProject('cnc', depthRelief());
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      await act(async () => {
        width.value = '125';
        Simulate.change(width);
      });
      await act(async () => {
        useStore.setState((state) => ({
          project: {
            ...state.project,
            scene: { ...state.project.scene, objects: [depthRelief()] },
          },
          projectDocumentEpoch: state.projectDocumentEpoch + 1,
          selectedObjectId: 'R1',
        }));
      });
      await act(async () => vi.advanceTimersByTime(350));

      const stored = useStore.getState().project.scene.objects[0];
      expect(stored?.kind === 'relief' ? stored.targetWidthMm : null).toBe(100);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it('does not retarget a pending width edit when the selected relief changes', async () => {
    vi.useFakeTimers();
    installProject('cnc');
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: [relief(), { ...relief(), id: 'R2', source: 'second.stl' }],
        },
      },
    });
    useStore.getState().selectObject('R1');
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      await act(async () => {
        width.value = '125';
        Simulate.change(width);
      });
      await act(async () => useStore.getState().selectObject('R2'));
      await act(async () => vi.advanceTimersByTime(300));

      const widths = useStore
        .getState()
        .project.scene.objects.filter((object) => object.kind === 'relief')
        .map((object) => object.targetWidthMm);
      expect(widths).toEqual([100, 100]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
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
      expect(
        stored?.kind === 'relief' && stored.reliefSource.kind === 'legacy-mesh'
          ? stored.reliefSource.emptyCells
          : undefined,
      ).toBe('top');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('shows depth-map precision and input levels after polarity without mesh controls', async () => {
    installProject('cnc', depthRelief());
    const beforeProject = useStore.getState().project;
    const beforeUndoStack = useStore.getState().undoStack;
    const beforeDirty = useStore.getState().dirty;
    const { host, root } = await render();
    try {
      expect(host.textContent).toContain('2 x 1, canonical 16-bit (source 8-bit)');
      expect(host.querySelector('select[aria-label="Relief background"]')).toBeNull();
      expect(host.querySelector('[aria-label="Relief declared source meaning"]')).not.toBeNull();
      expect(useStore.getState().project).toBe(beforeProject);
      expect(useStore.getState().undoStack).toBe(beforeUndoStack);
      expect(useStore.getState().dirty).toBe(beforeDirty);
      const select = host.querySelector('select[aria-label="Relief height-map polarity"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('polarity select missing');
      const levels = host.querySelector('[aria-label="Relief input levels"]');
      if (!(levels instanceof HTMLDivElement)) throw new Error('input levels missing');
      expect(select.closest('label')?.nextElementSibling).toBe(levels);
      await act(async () => {
        select.value = 'light-is-deep';
        Simulate.change(select);
      });

      const stored = useStore.getState().project.scene.objects[0];
      expect(
        stored?.kind === 'relief' && stored.reliefSource.kind === 'heightfield-v1'
          ? stored.reliefSource.mapping.polarity
          : undefined,
      ).toBe('light-is-deep');
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
