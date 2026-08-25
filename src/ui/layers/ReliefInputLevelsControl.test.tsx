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
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefInputLevelsControl } from './ReliefInputLevelsControl';
import { SelectedReliefProperties } from './SelectedReliefProperties';

// React's act-environment flag is absent from the standard global type, so expose it in this test.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MAX_U16_CODE = 0xffff;
const REAL_SET_RELIEF_PARAMS = useStore.getState().setReliefParams;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  useStore.setState({ setReliefParams: REAL_SET_RELIEF_PARAMS });
  resetStore();
  vi.useRealTimers();
});

function heightfieldRelief(
  inputLowCode = 0,
  inputHighCode = MAX_U16_CODE,
  id = 'heightfield-relief',
): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id,
    source: 'depth.png',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      mapping: { inputLowCode, inputHighCode },
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

function installSelectedReliefs(...objects: ReadonlyArray<HeightfieldReliefObject>): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects,
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project });
  useStore.getState().setMachineKind('cnc');
  useStore.getState().selectObject(objects[0]?.id ?? '');
}

function storedLevels(id: string): readonly [number, number] | null {
  const stored = useStore.getState().project.scene.objects.find((object) => object.id === id);
  return stored?.kind === 'relief' && stored.reliefSource.kind === 'heightfield-v1'
    ? [stored.reliefSource.mapping.inputLowCode, stored.reliefSource.mapping.inputHighCode]
    : null;
}

async function render(
  relief: HeightfieldReliefObject,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ReliefInputLevelsControl relief={relief} />);
  });
  return { host, root };
}

function input(host: HTMLElement, endpoint: 'low' | 'high'): HTMLInputElement {
  const found = host.querySelector(`input[aria-label="Relief input ${endpoint} source code"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${endpoint} input missing`);
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

describe('ReliefInputLevelsControl', () => {
  it('renders both endpoints with all mapping cases visible', async () => {
    const heightfieldRender = await render(heightfieldRelief());
    try {
      const group = heightfieldRender.host.querySelector('[aria-label="Relief input levels"]');
      expect(group).not.toBeNull();
      expect(group?.textContent).toContain('Low < high clips outside the endpoints');
      expect(group?.textContent).toContain('Crossed endpoints reverse the response and are valid');
      expect(group?.textContent).toContain(
        'Equal endpoints produce a flat normalized 0.5 before the stored curve and polarity',
      );
    } finally {
      await unmount(heightfieldRender.root, heightfieldRender.host);
    }
  });

  it('shows both inclusive endpoints as exact step-one source codes', async () => {
    const { host, root } = await render(heightfieldRelief(0, MAX_U16_CODE));
    try {
      const low = input(host, 'low');
      const high = input(host, 'high');
      expect([low.value, high.value]).toEqual(['0', '65535']);
      expect([low.min, high.min]).toEqual(['0', '0']);
      expect([low.max, high.max]).toEqual(['65535', '65535']);
      expect([low.step, high.step]).toEqual(['1', '1']);
    } finally {
      await unmount(root, host);
    }
  });

  it('commits equal and crossed endpoints independently without rewriting either one', async () => {
    const setReliefParams = vi.fn();
    useStore.setState({ setReliefParams });
    const { host, root } = await render(heightfieldRelief(100, 200));
    try {
      const low = input(host, 'low');
      const high = input(host, 'high');

      await changeAndBlur(low, '200');
      expect(setReliefParams).toHaveBeenLastCalledWith('heightfield-relief', {
        inputLowCode: 200,
      });
      expect(low.value).toBe('200');
      expect(high.value).toBe('200');

      await changeAndBlur(high, '50');
      expect(setReliefParams).toHaveBeenLastCalledWith('heightfield-relief', {
        inputHighCode: 50,
      });
      expect(low.value).toBe('200');
      expect(high.value).toBe('50');
      expect(setReliefParams).toHaveBeenCalledTimes(2);
    } finally {
      await unmount(root, host);
    }
  });

  it('cancels a pending R1 edit when selection renders R2 and preserves both mappings', async () => {
    installSelectedReliefs(heightfieldRelief(100, 200, 'R1'), heightfieldRelief(300, 400, 'R2'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<SelectedReliefProperties />);
    });
    try {
      const r1Low = input(host, 'low');
      await act(async () => {
        r1Low.value = '150';
        Simulate.change(r1Low);
      });

      await act(async () => useStore.getState().selectObject('R2'));
      expect(input(host, 'low').value).toBe('300');
      expect(input(host, 'high').value).toBe('400');

      await act(async () => vi.advanceTimersByTime(300));
      expect(storedLevels('R1')).toEqual([100, 200]);
      expect(storedLevels('R2')).toEqual([300, 400]);
    } finally {
      await unmount(root, host);
    }
  });

  it('cancels a pending edit when a replacement project reuses the relief id', async () => {
    installSelectedReliefs(heightfieldRelief(100, 200, 'R1'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<SelectedReliefProperties />);
    });
    try {
      const originalLow = input(host, 'low');
      await act(async () => {
        originalLow.value = '150';
        Simulate.change(originalLow);
      });

      const current = useStore.getState().project;
      const replacement: Project = {
        ...current,
        scene: {
          ...current.scene,
          objects: [heightfieldRelief(300, 400, 'R1')],
        },
      };
      await act(async () => {
        useStore.getState().setProject(replacement);
      });
      expect(input(host, 'low').value).toBe('300');
      expect(input(host, 'high').value).toBe('400');

      await act(async () => vi.advanceTimersByTime(300));
      expect(storedLevels('R1')).toEqual([300, 400]);
    } finally {
      await unmount(root, host);
    }
  });

  it('cancels a pending edit when a replacement project reuses the id and endpoint', async () => {
    installSelectedReliefs(heightfieldRelief(100, 200, 'R1'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<SelectedReliefProperties />);
    });
    try {
      const originalLow = input(host, 'low');
      await act(async () => {
        originalLow.value = '150';
        Simulate.change(originalLow);
      });

      const current = useStore.getState().project;
      const replacement: Project = {
        ...current,
        scene: {
          ...current.scene,
          objects: [heightfieldRelief(100, 200, 'R1')],
        },
      };
      await act(async () => {
        useStore.getState().setProject(replacement);
      });

      await act(async () => vi.advanceTimersByTime(300));
      expect(storedLevels('R1')).toEqual([100, 200]);
    } finally {
      await unmount(root, host);
    }
  });

  it('does not let an invalid pending draft overwrite a newer canonical endpoint', async () => {
    installSelectedReliefs(heightfieldRelief(100, 400, 'R1'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<SelectedReliefProperties />);
    });
    try {
      const low = input(host, 'low');
      await act(async () => {
        low.value = '1.5';
        Simulate.change(low);
      });

      await act(async () => {
        useStore.getState().setReliefParams('R1', { inputLowCode: 200 });
      });
      const undoAfterExternalEdit = useStore.getState().undoStack.length;
      expect(storedLevels('R1')).toEqual([200, 400]);

      await act(async () => vi.advanceTimersByTime(300));
      expect(storedLevels('R1')).toEqual([200, 400]);
      expect(useStore.getState().undoStack).toHaveLength(undoAfterExternalEdit);

      await act(async () => Simulate.blur(input(host, 'low')));
      expect(input(host, 'low').value).toBe('200');
    } finally {
      await unmount(root, host);
    }
  });

  it.each([
    { draft: '' },
    { draft: '1.5' },
    { draft: '1.0000000000000001' },
    { draft: '65535.0000000000000001' },
    { draft: '1e-324' },
    { draft: '-1' },
    { draft: '65536' },
    { draft: '1e309' },
  ])(
    'restores the prior exact value after invalid draft $draft without committing',
    async ({ draft }) => {
      const setReliefParams = vi.fn();
      useStore.setState({ setReliefParams });
      const { host, root } = await render(heightfieldRelief(12345, 54321));
      try {
        const low = input(host, 'low');
        await act(async () => {
          // Number inputs sanitize browser-invalid numeric text before React receives it; using
          // the actual element keeps this regression on the same path as production.
          low.value = draft;
          Simulate.change(low);
          vi.advanceTimersByTime(400);
        });
        expect(setReliefParams).not.toHaveBeenCalled();

        await act(async () => Simulate.blur(low));
        expect(setReliefParams).not.toHaveBeenCalled();
        expect(input(host, 'low').value).toBe('12345');
        expect(input(host, 'high').value).toBe('54321');
      } finally {
        await unmount(root, host);
      }
    },
  );
});
