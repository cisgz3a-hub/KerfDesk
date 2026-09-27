import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import type { BatchTraceFile, RawImageData } from '../../core/trace';
import { TraceRequestSupersededError } from '../trace/use-trace-worker-client';
import { runMultiFileTrace, type MultiFileTraceFile } from './multi-file-trace-action';
import { INTERRUPTED_TRACE_MESSAGE } from './multi-file-trace-retry';

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

const rawImage = (): RawImageData => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) });
const files = (...names: string[]): MultiFileTraceFile[] =>
  names.map((name) => ({ name, size: 1 }) as MultiFileTraceFile);

function recordWrites(written: string[]): (file: BatchTraceFile) => Promise<boolean> {
  return async (file) => {
    written.push(file.filename);
    return true;
  };
}

describe('Multi-File Trace and the shared trace worker', () => {
  it('reports Cancel during a worker trace as cancelled, not as an error', async () => {
    // The worker client answers its signal's abort with a superseded rejection.
    const controller = new AbortController();
    const pushToast = vi.fn();
    await runMultiFileTrace(files('a.png', 'b.png'), pushToast, {
      loadImage: async () => rawImage(),
      trace: async () => {
        controller.abort();
        throw new TraceRequestSupersededError();
      },
      signal: controller.signal,
      write: recordWrites([]),
    });
    expect(pushToast.mock.calls).toEqual([
      ['Multi-File Trace cancelled. 0 of 2 images were written.', 'info'],
    ]);
  });

  it('retries a file whose trace another caller superseded', async () => {
    const written: string[] = [];
    const pushToast = vi.fn();
    let calls = 0;
    await runMultiFileTrace(files('a.png', 'b.png', 'c.png'), pushToast, {
      loadImage: async () => rawImage(),
      trace: async () => {
        calls += 1;
        // A Trace Image preview starts while b.png is tracing.
        if (calls === 2) throw new TraceRequestSupersededError();
        return [SQUARE_PATH];
      },
      write: recordWrites(written),
    });
    expect(written).toEqual(['a-trace.svg', 'b-trace.svg', 'c-trace.svg']);
    expect(pushToast.mock.calls[0]?.[1]).not.toBe('error');
  });

  it('skips a file that keeps being superseded and traces the rest', async () => {
    const written: string[] = [];
    const pushToast = vi.fn();
    await runMultiFileTrace(files('a.png', 'b.png', 'c.png'), pushToast, {
      loadImage: async (file) => ({ ...rawImage(), width: file.name === 'b.png' ? 5 : 4 }),
      trace: async (image) => {
        if (image.width === 5) throw new TraceRequestSupersededError();
        return [SQUARE_PATH];
      },
      write: recordWrites(written),
    });
    expect(written).toEqual(['a-trace.svg', 'c-trace.svg']);
    const [text, kind] = pushToast.mock.calls[0] ?? [];
    expect(kind).not.toBe('error');
    expect(text).toContain('b.png');
    expect(text).toContain(INTERRUPTED_TRACE_MESSAGE);
  });
});
