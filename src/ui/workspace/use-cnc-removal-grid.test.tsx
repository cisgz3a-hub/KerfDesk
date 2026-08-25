import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import type { Toolpath } from '../../core/job';
import { useCncRemovalGrid } from './use-cnc-removal-grid';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const workerMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock('./cnc-removal-grid-worker-client', () => ({
  prepareCncRemovalGridOffThread: workerMocks.prepare,
  isCncRemovalGridSuperseded: () => false,
}));

const PROJECT: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const TOOLPATH: Toolpath = {
  totalLength: 10,
  steps: [
    {
      kind: 'cut',
      color: '#000000',
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      length: 10,
      z: { from: -1, to: -1 },
    },
  ],
};
const GRID: RemovalGrid = {
  widthCells: 1,
  heightCells: 1,
  widthMm: 1,
  heightMm: 1,
  mmPerCell: 1,
  originX: 0,
  originY: 0,
  depth: new Float32Array([-1]),
  resolution: { requestedMmPerCell: 1, effectiveMmPerCell: 1, reason: null },
};

let host: HTMLDivElement;
let root: Root;
let observed: RemovalGrid | null = null;

beforeEach(() => {
  workerMocks.prepare.mockReset();
  observed = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('useCncRemovalGrid', () => {
  it('publishes the completed background grid', async () => {
    workerMocks.prepare.mockResolvedValueOnce(GRID);
    await render(true);
    expect(workerMocks.prepare).toHaveBeenCalledOnce();
    expect(observed).toBe(GRID);
  });

  it('cancels hidden preview work and suppresses a delayed completion', async () => {
    let finish: ((grid: RemovalGrid | null) => void) | null = null;
    workerMocks.prepare.mockReturnValueOnce(
      new Promise<RemovalGrid | null>((resolve) => {
        finish = resolve;
      }),
    );
    await render(true);
    expect(observed).toBeNull();
    const signal = workerMocks.prepare.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);

    await render(false);
    expect(signal?.aborted).toBe(true);
    await act(async () => finish?.(GRID));

    expect(observed).toBeNull();
  });

  it('shows no grid instead of falling back synchronously when the worker is unavailable', async () => {
    workerMocks.prepare.mockReturnValueOnce(null);
    await render(true);
    expect(workerMocks.prepare).toHaveBeenCalledOnce();
    expect(observed).toBeNull();
  });
});

async function render(previewMode: boolean): Promise<void> {
  await act(async () => {
    root.render(<Harness previewMode={previewMode} />);
  });
}

function Harness(props: { readonly previewMode: boolean }): null {
  observed = useCncRemovalGrid(PROJECT, props.previewMode, TOOLPATH, 1);
  return null;
}
