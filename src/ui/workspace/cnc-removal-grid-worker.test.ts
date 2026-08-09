import { describe, expect, it } from 'vitest';
import {
  cncPreviewResponseTransferables,
  type CncRemovalGridWorkerResponse,
} from './cnc-removal-grid-worker-protocol';

describe('CNC preview response ownership', () => {
  it('carries grid resolution evidence alongside the transferred depth buffer', () => {
    const depth = new Float32Array([-1]);
    const response: CncRemovalGridWorkerResponse = {
      id: 1,
      kind: 'grid',
      grid: {
        widthCells: 1,
        heightCells: 1,
        widthMm: 0.5,
        heightMm: 0.5,
        mmPerCell: 0.5,
        originX: 0,
        originY: 0,
        depth,
        resolution: {
          requestedMmPerCell: 0.2,
          effectiveMmPerCell: 0.5,
          reason: 'interactive-preview-cell-budget',
        },
      },
    };

    expect(response.grid?.resolution).toEqual({
      requestedMmPerCell: 0.2,
      effectiveMmPerCell: 0.5,
      reason: 'interactive-preview-cell-budget',
    });
    expect(cncPreviewResponseTransferables(response)).toEqual([depth.buffer]);
  });

  it('transfers depth and inclusion buffers for canonical relief results', () => {
    const depth = new Float32Array([-1, 0]);
    const inclusion = Uint8Array.from([1, 0]);
    const response: CncRemovalGridWorkerResponse = {
      id: 1,
      kind: 'relief-heightmaps',
      items: [
        {
          taskId: 'relief',
          result: {
            kind: 'ok',
            heightmap: {
              widthCells: 2,
              heightCells: 1,
              widthMm: 2,
              heightMm: 1,
              mmPerCell: 1,
              depth,
              inclusion,
            },
            widthMm: 2,
            heightMm: 1,
          },
        },
      ],
    };

    expect(cncPreviewResponseTransferables(response)).toEqual([depth.buffer, inclusion.buffer]);
  });
});
