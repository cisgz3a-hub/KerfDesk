import { describe, expect, it } from 'vitest';
import type { ReliefObject } from '../../core/scene';
import {
  canvasCompilationResultTransferables,
  executeCanvasCompilationTask,
} from './canvas-compilation-worker-protocol';

const SOURCE: NonNullable<ReliefObject['depthMap']> = {
  schemaVersion: 1,
  width: 2,
  height: 1,
  bitDepth: 8,
  samplesBase64: 'AP8=',
  polarity: 'light-is-high',
};

describe('canvas compilation relief task', () => {
  it('materializes through the real bounded-worker task registry and transfers ownership', () => {
    const result = executeCanvasCompilationTask({
      kind: 'relief-heightmap',
      source: SOURCE,
      options: { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
    });

    expect(result).toMatchObject({ kind: 'relief-heightmap', output: { kind: 'ok' } });
    if (result.kind !== 'relief-heightmap' || result.output.kind !== 'ok') return;
    expect([...result.output.heightmap.depth]).toEqual([-5, 0]);
    expect(canvasCompilationResultTransferables(result)).toEqual([
      result.output.heightmap.depth.buffer,
    ]);
  });
});
