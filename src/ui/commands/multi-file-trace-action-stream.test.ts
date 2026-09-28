import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import type { BatchTraceFile, RawImageData } from '../../core/trace';
import { runMultiFileTrace, type MultiFileTraceFile } from './multi-file-trace-action';

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

const FILES = ['a.png', 'b.png', 'c.png'].map(namedFile);

describe('Multi-File Trace writes as it goes (rank 21)', () => {
  it('writes each file in order before tracing the next, holding one export', async () => {
    const events: string[] = [];
    const progress: number[] = [];
    await runMultiFileTrace(FILES, vi.fn(), {
      loadImage: async (file) => {
        events.push(`decode ${file.name}`);
        return rawImage(4, 4);
      },
      trace: async () => [SQUARE_PATH],
      onProgress: (current, total) => progress.push(current / total),
      write: async (file: BatchTraceFile) => {
        events.push(`write ${file.filename}`);
        return true;
      },
    });
    expect(events).toEqual([
      'decode a.png',
      'write a-trace.svg',
      'decode b.png',
      'write b-trace.svg',
      'decode c.png',
      'write c-trace.svg',
    ]);
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('writes nothing more after Cancel and reports the count written', async () => {
    const controller = new AbortController();
    const pushToast = vi.fn();
    const written: string[] = [];
    const trace = vi.fn(async () => [SQUARE_PATH]);
    await runMultiFileTrace(FILES, pushToast, {
      loadImage: async () => rawImage(4, 4),
      trace,
      signal: controller.signal,
      write: async (file: BatchTraceFile) => {
        written.push(file.filename);
        controller.abort();
        return true;
      },
    });
    expect(written).toEqual(['a-trace.svg']);
    expect(trace).toHaveBeenCalledTimes(1);
    expect(pushToast).toHaveBeenCalledWith(
      'Multi-File Trace cancelled. 1 of 3 images were written.',
      'info',
    );
  });

  it('does not write a file that finished tracing after Cancel', async () => {
    const controller = new AbortController();
    const write = vi.fn(async () => true);
    const pushToast = vi.fn();
    await runMultiFileTrace(FILES, pushToast, {
      loadImage: async () => rawImage(4, 4),
      trace: async () => {
        controller.abort();
        return [SQUARE_PATH];
      },
      signal: controller.signal,
      write,
    });
    expect(write).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Multi-File Trace cancelled. 0 of 3 images were written.',
      'info',
    );
  });
});
