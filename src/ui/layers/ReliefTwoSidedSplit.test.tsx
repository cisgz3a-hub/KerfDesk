import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefTwoSidedSplit } from './ReliefTwoSidedSplit';

// ADR-580 Amendment 1: a side of a split says which side it is and the stock
// both sides follow now, and offers no second split.

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});

function relief(record?: MeshReliefObject['twoSidedSplit']): MeshReliefObject {
  return {
    kind: 'relief',
    id: 'side',
    source: 'model.stl (side A, top)',
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
      emptyCells: 'floor',
    },
    targetWidthMm: 1,
    reliefDepthMm: 1,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    ...(record === undefined ? {} : { twoSidedSplit: record }),
  };
}

async function render(object: MeshReliefObject, stockMm: number): Promise<string> {
  useStore.setState({
    project: {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: stockMm },
      },
    },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ReliefTwoSidedSplit relief={object} />));
  return host.textContent ?? '';
}

describe('ReliefTwoSidedSplit', () => {
  it('names the side and the stock it follows now, with no second split', async () => {
    const text = await render(
      relief({ side: 'A', stockThicknessMm: 14, modelDepthMm: 10, splitHeightMm: 5, webMm: 1 }),
      18,
    );
    expect(text).toContain('Side A (top) of a split 10 mm model');
    expect(text).toContain('centred in the 18 mm stock');
    expect(host.querySelector('button')).toBeNull();
  });

  it('says a stock thinner than the model cuts it down', async () => {
    const text = await render(
      relief({ side: 'B', stockThicknessMm: 14, modelDepthMm: 10, splitHeightMm: 5, webMm: 1 }),
      8,
    );
    expect(text).toContain('Side B (bottom)');
    expect(text).toContain('the part comes out 8 mm thick');
  });

  it('offers the split on an STL relief that is not a side', async () => {
    const text = await render(relief(), 14);
    expect(text).toContain('centred in the 14 mm stock');
    expect(text).toContain('Both sides follow a later change to the stock thickness');
    expect(host.querySelector('button')?.textContent).toBe('Create side A and side B');
  });
});
