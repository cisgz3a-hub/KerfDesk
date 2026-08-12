import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemovalGrid } from '../../core/sim';

const scene = vi.hoisted(() => ({
  create: vi.fn(),
  handle: {
    dispose: vi.fn(),
    updateContent: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn(),
    setScrubMm: vi.fn(),
    setDisplayMode: vi.fn(),
    setSectionFraction: vi.fn(),
    capturePng: vi.fn(),
    probeAt: vi.fn().mockReturnValue({ x: 0.49, y: -0.24, z: -2 }),
  },
}));

vi.mock('../relief-viewer/relief-three-scene', () => ({
  createReliefThreeScene: scene.create,
}));

import { useCnc3dScene, type Cnc3dScene, type DesignSceneSource } from './use-cnc-3d-scene';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let observed: Cnc3dScene | null = null;

afterEach(() => {
  document.body.innerHTML = '';
  observed = null;
  scene.create.mockReset();
  scene.create.mockResolvedValue({ kind: 'ok', handle: scene.handle });
  for (const mock of Object.values(scene.handle)) mock.mockClear();
});

describe('useCnc3dScene partial grid registration', () => {
  it('uses exact extents for the mesh and hover inverse transform', async () => {
    scene.create.mockResolvedValue({ kind: 'ok', handle: scene.handle });
    const source = partialSource();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Probe source={source} />);
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(observed?.state).toBe('ready'));

      const mesh = scene.create.mock.calls[0]?.[1] as
        | { readonly widthMm: number; readonly heightMm: number }
        | undefined;
      expect(mesh).toMatchObject({ widthMm: 1, heightMm: 0.5 });
      expect(scene.handle.updateContent).toHaveBeenCalledTimes(1);
      expect(scene.handle.updateContent.mock.calls[0]?.[0]).toMatchObject({
        heightfield: {
          widthCells: 4,
          heightCells: 2,
          widthMm: 1,
          heightMm: 0.5,
          mmPerCell: 0.3,
        },
        materialKey: 'hardwood',
      });
      expect(observed?.controls.probeAt(0, 0)).toEqual({
        xMm: 10.99,
        yMm: 20.49,
        depthMm: -2,
      });
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

function Probe(props: { readonly source: DesignSceneSource }): JSX.Element {
  observed = useCnc3dScene(props.source, 6, 1, null);
  return <canvas ref={observed.canvasRef} />;
}

function partialSource(): DesignSceneSource {
  const result = createRemovalGrid({
    originX: 10,
    originY: 20,
    widthMm: 1,
    heightMm: 0.5,
    mmPerCell: 0.3,
  });
  if (result.kind === 'error') throw new Error(result.reason);
  result.grid.depth[result.grid.depth.length - 1] = -2;
  return { grid: result.grid, materialKey: 'hardwood', moves: [], toolProfile: [] };
}
