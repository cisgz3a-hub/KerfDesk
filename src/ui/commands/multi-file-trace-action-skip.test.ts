import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import type { BatchTraceFile, RawImageData } from '../../core/trace';
import {
  buildMultiFileTraceExports,
  runMultiFileTrace,
  type MultiFileTraceFile,
} from './multi-file-trace-action';

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

function namedFile(name: string): MultiFileTraceFile {
  return { name, size: 1 } as MultiFileTraceFile;
}

describe('Multi-File Trace per-file failures (rank 19)', () => {
  it('writes the rest of the batch when the middle file cannot be decoded (rank 19)', async () => {
    const pushToast = vi.fn();
    const write = vi.fn(async (_file: BatchTraceFile) => true);
    const trace = vi.fn(async () => [SQUARE_PATH]);

    await runMultiFileTrace(
      [namedFile('a.png'), namedFile('bad.png'), namedFile('c.png')],
      pushToast,
      {
        loadImage: async (file) => {
          if (file.name === 'bad.png') throw new Error('Unsupported image data');
          return rawImage(4, 4);
        },
        trace,
        write,
      },
    );

    expect(write.mock.calls.map(([file]) => file.filename)).toEqual(['a-trace.svg', 'c-trace.svg']);
    expect(trace).toHaveBeenCalledTimes(2);
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringContaining(
        'Could not read 1 image (bad.png: Unsupported image data); it was skipped.',
      ),
      'warning',
    );
  });

  it('skips a file whose trace fails after its fallback, but still fails the batch on cancel', async () => {
    const trace = vi.fn(async (image: RawImageData) => {
      if (image.width === 5) throw new Error('Worker crashed');
      return [SQUARE_PATH];
    });
    const loadImage = async (file: MultiFileTraceFile) =>
      rawImage(file.name === 'b.png' ? 5 : 4, 4);
    const batch = await buildMultiFileTraceExports([namedFile('a.png'), namedFile('b.png')], {
      loadImage,
      trace,
    });
    expect(batch.files.map((file) => file.filename)).toEqual(['a-trace.svg']);
    expect(batch.skipped).toEqual([
      { sourceName: 'b.png', reason: 'trace-failed', message: 'Worker crashed' },
    ]);

    const cancelled = vi.fn(async () => {
      throw new DOMException('Trace cancelled', 'AbortError');
    });
    await expect(
      buildMultiFileTraceExports([namedFile('a.png'), namedFile('b.png')], {
        loadImage,
        trace: cancelled,
      }),
    ).rejects.toThrow('Trace cancelled');
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
