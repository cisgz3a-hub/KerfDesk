import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefPropertyControls } from './ReliefPropertyControls';
import { SelectedReliefProperties } from './SelectedReliefProperties';

// React's act-environment flag is absent from the standard global type, so expose it in this test.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const REAL_SET_RELIEF_PARAMS = useStore.getState().setReliefParams;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  useStore.setState({ setReliefParams: REAL_SET_RELIEF_PARAMS });
  resetStore();
  vi.useRealTimers();
});

function heightfieldRelief(threshold = 128, id = 'heightfield-relief'): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id,
    source: 'masked-depth.png',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      inclusionMask: [0, 255],
      mapping: { inclusionThreshold: threshold, outsideMask: 'stock-top' },
      provenance: { sourceName: `source-${threshold}.png` },
      revision: 7,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

function installSelected(relief: HeightfieldReliefObject): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [relief],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project });
  useStore.getState().setMachineKind('cnc');
  useStore.getState().selectObject(relief.id);
}

async function render(
  relief: HeightfieldReliefObject,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ReliefPropertyControls relief={relief} widthMm={100} targetScaleX={1} />);
  });
  return { host, root };
}

function thresholdInput(host: HTMLElement): HTMLInputElement {
  const found = host.querySelector('input[aria-label="Relief mask threshold"]');
  if (!(found instanceof HTMLInputElement)) throw new Error('mask threshold input missing');
  return found;
}

async function changeAndBlur(field: HTMLInputElement, draft: string): Promise<void> {
  await act(async () => {
    field.value = draft;
    Simulate.change(field);
  });
  await act(async () => Simulate.blur(field));
}

async function unmount(root: Root, host: HTMLElement): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
}

function storedRelief(id = 'heightfield-relief'): HeightfieldReliefObject {
  const stored = useStore.getState().project.scene.objects.find((object) => object.id === id);
  if (!isHeightfieldRelief(stored)) throw new Error('stored heightfield missing');
  return stored;
}

function isHeightfieldRelief(relief: SceneObject | undefined): relief is HeightfieldReliefObject {
  return relief?.kind === 'relief' && relief.reliefSource.kind === 'heightfield-v1';
}

describe('ReliefMaskThresholdControl', () => {
  it.each([1, 255])('shows inclusive endpoint %s as an exact step-one mask byte', async (value) => {
    const { host, root } = await render(heightfieldRelief(value));
    try {
      const field = thresholdInput(host);
      expect([field.value, field.min, field.max, field.step]).toEqual([
        String(value),
        '1',
        '255',
        '1',
      ]);
      expect(field.closest('label')?.textContent).toContain(
        `Mask bytes at or above ${value} use mapped depth`,
      );
      expect(field.closest('label')?.textContent).toContain(
        'lower bytes use the selected outside meaning',
      );
    } finally {
      await unmount(root, host);
    }
  });

  it('commits an exact decimal integer without rewriting it', async () => {
    const setReliefParams = vi.fn();
    useStore.setState({ setReliefParams });
    const { host, root } = await render(heightfieldRelief());
    try {
      await changeAndBlur(thresholdInput(host), '6.4e1');
      expect(setReliefParams).toHaveBeenCalledOnce();
      expect(setReliefParams).toHaveBeenCalledWith('heightfield-relief', {
        inclusionThreshold: 64,
      });
      expect(thresholdInput(host).value).toBe('64');
    } finally {
      await unmount(root, host);
    }
  });

  it.each(['', '0', '256', '1.5', '1.0000000000000001', '1e309'])(
    'restores 128 after invalid draft %s without committing',
    async (draft) => {
      const setReliefParams = vi.fn();
      useStore.setState({ setReliefParams });
      const { host, root } = await render(heightfieldRelief());
      try {
        await changeAndBlur(thresholdInput(host), draft);
        expect(setReliefParams).not.toHaveBeenCalled();
        expect(thresholdInput(host).value).toBe('128');
      } finally {
        await unmount(root, host);
      }
    },
  );

  it('stores 128 to 64 as one mapping-only revision and one undo frame', async () => {
    installSelected(heightfieldRelief());
    const before = storedRelief();
    const beforeSource = before.reliefSource;
    const undoCount = useStore.getState().undoStack.length;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<SelectedReliefProperties />));
    try {
      await changeAndBlur(thresholdInput(host), '64');
      const after = storedRelief();
      expect(after.reliefSource.mapping.inclusionThreshold).toBe(64);
      expect(after.reliefSource.revision).toBe(beforeSource.revision + 1);
      expect(useStore.getState().dirty).toBe(true);
      expect(useStore.getState().undoStack).toHaveLength(undoCount + 1);
      expect(after.reliefSource.samplesBase64).toBe(beforeSource.samplesBase64);
      expect(after.reliefSource.inclusionMask).toBe(beforeSource.inclusionMask);
      expect(after.reliefSource.digest).toBe(beforeSource.digest);
      expect(after.reliefSource.provenance).toBe(beforeSource.provenance);
      expect(after.reliefSource.physicalWidthMm).toBe(beforeSource.physicalWidthMm);
      expect(after.reliefSource.physicalHeightMm).toBe(beforeSource.physicalHeightMm);
      expect(after.bounds).toBe(before.bounds);
      expect(after.transform).toBe(before.transform);
    } finally {
      await unmount(root, host);
    }
  });

  it('cancels a pending edit when a replacement project reuses the id and value', async () => {
    installSelected(heightfieldRelief(128, 'R1'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<SelectedReliefProperties />));
    try {
      const field = thresholdInput(host);
      await act(async () => {
        field.value = '64';
        Simulate.change(field);
      });
      const current = useStore.getState().project;
      const replacement: Project = {
        ...current,
        scene: { ...current.scene, objects: [heightfieldRelief(128, 'R1')] },
      };
      await act(async () => useStore.getState().setProject(replacement));
      await act(async () => vi.advanceTimersByTime(400));
      expect(storedRelief('R1').reliefSource.mapping.inclusionThreshold).toBe(128);
      expect(storedRelief('R1').reliefSource.revision).toBe(7);
    } finally {
      await unmount(root, host);
    }
  });
});
