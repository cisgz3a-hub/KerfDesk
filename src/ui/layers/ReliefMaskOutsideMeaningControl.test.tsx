import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type ReliefObject,
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefPropertyControls } from './ReliefPropertyControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

function meshRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'mesh-relief',
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

function heightfieldRelief(options: {
  readonly inclusionMask?: ReadonlyArray<number>;
  readonly inclusionThreshold?: number;
  readonly outsideMask?: 'excluded' | 'stock-top' | 'relief-floor';
}): HeightfieldReliefObject {
  const reliefSource = testReliefHeightfield({
    width: 2,
    height: 1,
    physicalWidthMm: 100,
    physicalHeightMm: 50,
    maxDepthMm: 5,
    samplesU8: [0, 255],
    ...(options.inclusionMask === undefined ? {} : { inclusionMask: options.inclusionMask }),
    mapping: {
      ...(options.inclusionThreshold === undefined
        ? {}
        : { inclusionThreshold: options.inclusionThreshold }),
      outsideMask: options.outsideMask ?? 'excluded',
    },
  });
  return {
    kind: 'relief',
    id: 'heightfield-relief',
    source: 'depth.png',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

async function render(
  relief: ReliefObject,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ReliefPropertyControls relief={relief} widthMm={100} targetScaleX={1} />);
  });
  return { host, root };
}

function outsideMeaningSelect(host: HTMLElement): HTMLSelectElement {
  const select = host.querySelector('select[aria-label="Relief outside-mask meaning"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('outside-mask select missing');
  return select;
}

describe('ReliefPropertyControls outside-mask meaning', () => {
  it.each([
    ['a legacy mesh', meshRelief()],
    ['an unmasked heightfield', heightfieldRelief({})],
  ])('keeps the selector hidden for %s', async (_name, relief) => {
    const { host, root } = await render(relief);
    try {
      expect(host.querySelector('select[aria-label="Relief outside-mask meaning"]')).toBeNull();
      expect(host.querySelector('input[aria-label="Relief mask threshold"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('shows the exact persisted meaning after the editable threshold for a present mask', async () => {
    const { host, root } = await render(
      heightfieldRelief({
        inclusionMask: [0, 255],
        inclusionThreshold: 128,
        outsideMask: 'relief-floor',
      }),
    );
    try {
      const select = outsideMeaningSelect(host);
      expect(select.value).toBe('relief-floor');
      expect(Array.from(select.options, (option) => [option.value, option.text])).toEqual([
        ['excluded', 'Excluded from carving'],
        ['stock-top', 'Keep at stock top'],
        ['relief-floor', 'Carve to relief floor'],
      ]);
      const threshold = host.querySelector('input[aria-label="Relief mask threshold"]');
      if (!(threshold instanceof HTMLInputElement)) throw new Error('threshold input missing');
      expect(threshold.value).toBe('128');
      expect(threshold.closest('label')?.nextElementSibling).toBe(select.closest('label'));
      expect(select.closest('label')?.textContent).toContain('Below threshold');
      expect(select.title).toContain('at or above 128 use mapped depth');
      expect(select.closest('label')?.textContent).toContain(
        'Mask bytes below 128 use this selected outside meaning',
      );
      expect(host.textContent).not.toContain('read-only here');
      expect(host.textContent).not.toContain('16-bit alpha');
      expect(host.textContent).not.toContain('full mask');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps an all-opaque stored mask visible and commits its selected meaning after Gamma', async () => {
    const setReliefParams = vi.fn();
    useStore.setState({ setReliefParams });
    const { host, root } = await render(
      heightfieldRelief({ inclusionMask: [255, 255], outsideMask: 'excluded' }),
    );
    try {
      const select = outsideMeaningSelect(host);
      const gamma = host.querySelector('input[aria-label="Relief height-map gamma"]');
      const threshold = host.querySelector('input[aria-label="Relief mask threshold"]');
      if (!(gamma instanceof HTMLInputElement)) throw new Error('gamma input missing');
      if (!(threshold instanceof HTMLInputElement)) throw new Error('threshold input missing');
      expect(gamma.closest('label')?.nextElementSibling).toBe(threshold.closest('label'));
      expect(threshold.closest('label')?.nextElementSibling).toBe(select.closest('label'));
      expect(select.closest('label')?.textContent).toContain('Below threshold');
      expect(host.textContent).not.toContain('read-only here');

      await act(async () => {
        select.value = 'stock-top';
        Simulate.change(select);
      });

      expect(setReliefParams).toHaveBeenCalledOnce();
      expect(setReliefParams).toHaveBeenCalledWith('heightfield-relief', {
        outsideMask: 'stock-top',
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
