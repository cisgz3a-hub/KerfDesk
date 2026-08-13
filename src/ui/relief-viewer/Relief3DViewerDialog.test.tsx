// jsdom has no WebGL, so the dialog's graceful fallback IS the testable
// path (ADR-102 §4): the real three.js import runs, the renderer fails to
// start, and the viewer reports it instead of crashing.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { IDENTITY_TRANSFORM, type ReliefObject } from '../../core/scene';

const worker = vi.hoisted(() => ({
  prepare: vi.fn(),
  prepareSurface: vi.fn(),
}));

vi.mock('../workspace/cnc-removal-grid-worker-client', () => ({
  prepareReliefHeightmapOffThread: worker.prepare,
  prepareCncCut3DSurfaceOffThread: worker.prepareSurface,
}));

import { Relief3DViewerDialog } from './Relief3DViewerDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  worker.prepare.mockReset();
  worker.prepareSurface.mockReset();
  worker.prepareSurface.mockResolvedValue({
    positions: new Float32Array([0, 0, -1]),
    indices: new Uint32Array(),
    normals: new Float32Array([0, 0, 1]),
    widthMm: 1,
    heightMm: 1,
  });
});

function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    // One tilted triangle — enough for a real heightmap.
    targetWidthMm: 100,
    reliefDepthMm: 5,
    ...testLegacyMeshGeometry({
      positions: [0, 0, 0, 10, 0, 2, 0, 10, 4],
      targetWidthMm: 100,
    }),
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
}

function depthMapRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'D1',
    source: 'height-map.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 50,
      physicalHeightMm: 25,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      provenance: { sourceName: 'height-map.png' },
    }),
    targetWidthMm: 50,
    reliefDepthMm: 5,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 25 },
    transform: IDENTITY_TRANSFORM,
  };
}

describe('Relief3DViewerDialog', () => {
  it('renders the dialog frame and falls back gracefully without WebGL', async () => {
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        const tinyWidthRelief = {
          ...relief(),
          transform: { ...IDENTITY_TRANSFORM, scaleX: 0.005 },
        };
        root.render(
          <Relief3DViewerDialog
            relief={tinyWidthRelief}
            stockThicknessMm={6.35}
            onClose={onClose}
          />,
        );
      });

      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(host.textContent).toContain('model.stl');
      expect(host.textContent).toContain('0.5 mm wide');
      expect(host.textContent).toContain(
        'Relief 3D preview uses 0.390625 mm display cells (0.25 mm nominal target)',
      );
      // jsdom: the three renderer cannot start → the fallback line shows
      // once the lazy import + scene setup settle (real task turns).
      await vi.waitFor(
        () => {
          expect(host.textContent).toContain('3D view unavailable');
        },
        { timeout: 20_000 },
      );
      expect(worker.prepare).not.toHaveBeenCalled();
      expect(worker.prepareSurface.mock.calls[0]?.[0]).toMatchObject({
        resolution: {
          requestedMmPerCell: 0.25,
          effectiveMmPerCell: 0.390625,
          reason: 'display-mesh-cell-budget',
        },
      });

      const close = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Close',
      );
      if (close === undefined) throw new Error('Close button missing');
      await act(async () => {
        close.click();
      });
      expect(onClose).toHaveBeenCalled();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  }, 30_000);

  it('materializes depth maps in the shared worker and aborts when the dialog closes', async () => {
    const transformedRelief = {
      ...depthMapRelief(),
      transform: { ...IDENTITY_TRANSFORM, scaleX: 0.5, scaleY: 20 },
    };
    worker.prepare.mockReturnValue(
      Promise.resolve({
        kind: 'ok',
        heightmap: {
          widthCells: 2,
          heightCells: 1,
          mmPerCell: 500 / 256,
          depth: new Float32Array([-5, 0]),
        },
        widthMm: 25,
        heightMm: 500,
      }),
    );
    const surface = deferred<{
      positions: Float32Array;
      indices: Uint32Array;
      normals: Float32Array;
      widthMm: number;
      heightMm: number;
    }>();
    worker.prepareSurface.mockReturnValue(surface.promise);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <Relief3DViewerDialog
          relief={transformedRelief}
          stockThicknessMm={6.35}
          onClose={vi.fn()}
        />,
      );
    });
    // 25 x 500 mm after scale, so the 256-cell budget binds and the viewer
    // discloses the coarser display cells (ADR-292 Amendment 1).
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Relief 3D preview uses');

    await vi.waitFor(() => {
      expect(worker.prepare).toHaveBeenCalledOnce();
      expect(worker.prepareSurface).toHaveBeenCalledOnce();
    });
    expect(host.textContent).toContain('25 mm wide');
    expect(worker.prepare.mock.calls[0]?.[1]).toMatchObject({
      targetWidthMm: 50,
      targetScaleX: 0.5,
      targetScaleY: 20,
      mmPerCell: 500 / 256,
    });
    const signal = worker.prepare.mock.calls[0]?.[2] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);
    expect(worker.prepareSurface.mock.calls[0]?.[1]).toBe(signal);

    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    surface.resolve({
      positions: new Float32Array([0, 0, -1]),
      indices: new Uint32Array(),
      normals: new Float32Array([0, 0, 1]),
      widthMm: 1,
      heightMm: 1,
    });
    await surface.promise;
    host.remove();
  });

  it('uses the same nonuniform physical scale as relief CAM', async () => {
    worker.prepare.mockResolvedValue({
      kind: 'ok',
      heightmap: {
        widthCells: 2,
        heightCells: 1,
        mmPerCell: 0.390625,
        depth: new Float32Array([-5, 0]),
      },
      widthMm: 100,
      heightMm: 100,
    });
    const scaled: ReliefObject = {
      ...depthMapRelief(),
      transform: { ...IDENTITY_TRANSFORM, scaleX: -2, scaleY: 4 },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <Relief3DViewerDialog relief={scaled} stockThicknessMm={6.35} onClose={vi.fn()} />,
        );
      });

      await vi.waitFor(() => {
        expect(worker.prepare).toHaveBeenCalledOnce();
        expect(worker.prepareSurface).toHaveBeenCalledOnce();
      });
      expect(host.textContent).toContain('100 mm wide');
      expect(host.textContent).toContain('Preview only; CAM and G-code are unchanged.');
      expect(worker.prepare.mock.calls[0]?.[1]).toMatchObject({
        targetWidthMm: 50,
        targetScaleX: 2,
        targetScaleY: 4,
        mmPerCell: 0.390625,
      });
      expect(worker.prepareSurface.mock.calls[0]?.[0]).toMatchObject({
        resolution: {
          requestedMmPerCell: 0.25,
          effectiveMmPerCell: 0.390625,
          reason: 'display-mesh-cell-budget',
        },
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
