import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../scene';
import type { RawImageData } from './trace-image';
import { traceImagesToVectorFiles } from './batch-trace';

const SQUARE_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
    },
  ],
};

function rawImage(width: number, height: number): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

describe('traceImagesToVectorFiles per-file failures', () => {
  it('skips a job whose prepare, decode or trace fails when the caller allows it (rank 19)', async () => {
    const trace = vi.fn(async (image: RawImageData) => {
      if (image.width === 6) throw new Error('trace blew up');
      return [SQUARE_PATH];
    });
    const { files, skipped } = await traceImagesToVectorFiles(
      [
        { sourceName: 'a.png', image: rawImage(4, 4) },
        {
          sourceName: 'b.png',
          prepare: async () => {
            throw new Error('not an image');
          },
        },
        {
          sourceName: 'c.png',
          image: async () => {
            throw new Error('truncated');
          },
        },
        { sourceName: 'd.png', image: rawImage(6, 6) },
        {
          sourceName: 'e.png',
          prepare: async () => ({ sourceName: 'e.png', image: rawImage(4, 4) }),
        },
      ],
      { trace, canSkip: (error) => !(error instanceof DOMException) },
    );
    expect(files.map((file) => [file.filename, file.sourceIndex])).toEqual([
      ['a-trace.svg', 0],
      ['e-trace.svg', 4],
    ]);
    expect(skipped).toEqual([
      { sourceName: 'b.png', reason: 'decode-failed', message: 'not an image' },
      { sourceName: 'c.png', reason: 'decode-failed', message: 'truncated' },
      { sourceName: 'd.png', reason: 'trace-failed', message: 'trace blew up' },
    ]);
    await expect(
      traceImagesToVectorFiles([{ sourceName: 'a.png', image: rawImage(4, 4) }], {
        trace: async () => {
          throw new DOMException('Trace cancelled', 'AbortError');
        },
        canSkip: (error) => !(error instanceof DOMException),
      }),
    ).rejects.toThrow('Trace cancelled');
  });
});
