import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type ReliefObject,
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { SelectedReliefFieldGeometry } from './SelectedReliefFieldGeometry';

// React exposes no narrower typed test seam for this documented act-environment flag.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => document.body.replaceChildren());

function heightfieldRelief(): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'field.png',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

function legacyRelief(): ReliefObject {
  return {
    ...heightfieldRelief(),
    source: 'model.stl',
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
      emptyCells: 'floor',
    },
  };
}

async function render(relief: ReliefObject): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<SelectedReliefFieldGeometry relief={relief} />));
  return { host, root };
}

describe('SelectedReliefFieldGeometry', () => {
  it('integrates the read-only canonical geometry block', async () => {
    const { host, root } = await render(heightfieldRelief());
    try {
      const geometry = host.querySelector('[aria-label="Relief field geometry"]');
      if (!(geometry instanceof HTMLElement)) throw new Error('field geometry missing');
      expect(geometry.textContent).toContain('Physical size (relief W × H)100 × 50 mm');
      expect(geometry.textContent).toContain(
        'Nominal full source-cell pitch (relief X × Y)50 × 50 mm/cell',
      );
      expect(geometry.querySelector('input, select, button')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('preserves the legacy-mesh properties surface', async () => {
    const { host, root } = await render(legacyRelief());
    try {
      expect(host.childElementCount).toBe(0);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
