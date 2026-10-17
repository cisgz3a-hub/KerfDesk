import { describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import type { BatchTraceFile } from '../../core/trace/batch-trace';
import type { SaveDirectoryTarget, SaveTarget } from '../../platform/types';
import {
  runMultiFileTrace,
  traceFileWriterForDirectory,
  writeTraceFileWithPlatform,
} from './multi-file-trace-action';

const file: BatchTraceFile = {
  filename: 'sample-trace.svg',
  format: 'svg',
  text: '<svg/>',
  pathCount: 1,
  sourceIndex: 0,
};

function target(write: SaveTarget['write']): SaveTarget {
  return { displayName: file.filename, write } as SaveTarget;
}

describe('batch export cancellation at asynchronous save boundaries', () => {
  it('threads the live batch signal into the writer and reports no committed files', async () => {
    const controller = new AbortController();
    const write = vi.fn(async () => undefined);
    const directory: SaveDirectoryTarget = {
      file: () => target(write),
      exists: async () => {
        controller.abort();
        return false;
      },
    };
    const toast = vi.fn();
    await runMultiFileTrace([new File([], 'sample.png')], toast, {
      signal: controller.signal,
      loadImage: async () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }),
      trace: async () => [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 1, y: 1 },
                { x: 2, y: 1 },
                { x: 2, y: 2 },
                { x: 1, y: 2 },
              ],
            },
          ],
        },
      ],
      write: traceFileWriterForDirectory(directory),
    });
    expect(write).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      'Multi-File Trace cancelled. 0 of 1 image was written.',
      'info',
    );
  });

  it('does not write when cancelled while the per-file save picker is open', async () => {
    const controller = new AbortController();
    const write = vi.fn(async () => undefined);
    const platform = {
      ...mockPlatform(),
      pickFileForSave: async () => {
        controller.abort();
        return target(write);
      },
    };
    await expect(
      writeTraceFileWithPlatform(platform, file, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(write).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'stops collision lookup and writing after cancellation (collision=%s)',
    async (collision) => {
      const controller = new AbortController();
      const write = vi.fn(async () => undefined);
      const exists = vi
        .fn(async () => false)
        .mockImplementationOnce(async () => {
          controller.abort();
          return collision;
        });
      const directory: SaveDirectoryTarget = { exists, file: () => target(write) };
      await expect(
        traceFileWriterForDirectory(directory)(file, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(exists).toHaveBeenCalledOnce();
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('never opens a picker or allocates a file when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const platform = mockPlatform();
    const pick = vi.spyOn(platform, 'pickFileForSave');
    const allocate = vi.fn(() => target(vi.fn()));
    await expect(
      writeTraceFileWithPlatform(platform, file, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      traceFileWriterForDirectory({ file: allocate })(file, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(pick).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
  });
});
