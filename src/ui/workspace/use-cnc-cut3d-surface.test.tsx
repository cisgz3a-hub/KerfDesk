import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { RemovalGrid } from '../../core/sim';
import { useCncCut3DSurface, type CncCut3DSurfaceState } from './use-cnc-cut3d-surface';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const workerMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock('./cnc-removal-grid-worker-client', () => ({
  prepareCncCut3DSurfaceOffThread: workerMocks.prepare,
  isCncRemovalGridSuperseded: () => false,
}));

const GRID: RemovalGrid = {
  widthCells: 1,
  heightCells: 1,
  mmPerCell: 1,
  originX: 0,
  originY: 0,
  depth: new Float32Array([-1]),
  resolution: { requestedMmPerCell: 1, effectiveMmPerCell: 1, reason: null },
};
const MESH: ReliefSurfaceMeshWithNormals = {
  positions: new Float32Array([0, 0, -1]),
  normals: new Float32Array([0, 0, 1]),
  indices: new Uint32Array(),
  widthMm: 1,
  heightMm: 1,
};

let host: HTMLDivElement;
let root: Root;
let observed: CncCut3DSurfaceState = { kind: 'idle' };

beforeEach(() => {
  workerMocks.prepare.mockReset();
  observed = { kind: 'idle' };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('useCncCut3DSurface', () => {
  it('prepares lazily and publishes only the completed worker mesh', async () => {
    let finish: ((mesh: ReliefSurfaceMeshWithNormals) => void) | null = null;
    workerMocks.prepare.mockReturnValueOnce(
      new Promise<ReliefSurfaceMeshWithNormals>((resolve) => {
        finish = resolve;
      }),
    );
    await render(true);
    expect(observed.kind).toBe('loading');
    expect(workerMocks.prepare).toHaveBeenCalledWith(GRID, expect.any(AbortSignal));
    await act(async () => finish?.(MESH));
    expect(observed).toEqual({ kind: 'ready', mesh: MESH, revision: 1 });
  });

  it('cancels a closing dialog and suppresses its delayed completion', async () => {
    let finish: ((mesh: ReliefSurfaceMeshWithNormals) => void) | null = null;
    workerMocks.prepare.mockReturnValueOnce(
      new Promise<ReliefSurfaceMeshWithNormals>((resolve) => {
        finish = resolve;
      }),
    );
    await render(true);
    const signal = workerMocks.prepare.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);
    await render(false);
    expect(signal?.aborted).toBe(true);
    await act(async () => finish?.(MESH));
    expect(observed.kind).toBe('idle');
  });

  it('reports a recoverable unavailable state instead of running on the UI thread', async () => {
    workerMocks.prepare.mockReturnValueOnce(null);
    await render(true);
    expect(observed).toEqual({
      kind: 'unavailable',
      reason: 'Background 3D preparation is unavailable.',
    });
  });
});

async function render(active: boolean): Promise<void> {
  await act(async () => root.render(<Harness active={active} />));
}

function Harness(props: { readonly active: boolean }): null {
  observed = useCncCut3DSurface(GRID, props.active);
  return null;
}
