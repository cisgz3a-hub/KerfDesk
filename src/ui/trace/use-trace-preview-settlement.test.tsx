import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./image-loader', () => ({ PREVIEW_MAX_EDGE_PX: 2048, loadImageAsRawData: vi.fn() }));
vi.mock('./region-enhance-trace', () => ({ traceImageWithBoundaryMode: vi.fn() }));
vi.mock('./raw-image-transparency', () => ({ rawImageHasTransparency: vi.fn(() => true) }));
import {
  TRACE_PRESETS,
  type TraceOptions,
  type TraceBoundary,
  type RawImageData,
} from '../../core/trace';
import type { BoundaryMode } from './region-enhance-trace';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { loadImageAsRawData } from './image-loader';
import { rawImageHasTransparency } from './raw-image-transparency';
import { useTracePreview, type TracePreviewState } from './use-trace-preview';
import type { TracePreviewCommitControl } from './use-trace-preview-settlement';
import { TraceRequestSupersededError, type TraceResult } from './use-trace-worker-client';
import type { TraceGrid } from './trace-boundary-grid';
const image: RawImageData = { width: 4, height: 2, data: new Uint8ClampedArray(32) },
  empty: TraceResult = {
    width: 4,
    height: 2,
    paths: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
const full: TraceResult = {
  ...empty,
  bounds: { minX: 1, minY: 0, maxX: 3, maxY: 1 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 1, y: 0 },
            { x: 3, y: 1 },
          ],
        },
      ],
    },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Props = {
  file: File | null;
  options: TraceOptions;
  boundary?: TraceBoundary | null;
  mode?: BoundaryMode;
  grid?: TraceGrid;
};
const control = createRef<TracePreviewCommitControl>();
let state: TracePreviewState, root: Root, host: HTMLDivElement;
let traces: Array<ReturnType<typeof deferred<TraceResult>>>;
function Probe(p: Props) {
  state = useTracePreview(p.file, p.options, p.boundary, p.mode, p.grid, control);
  return null;
}
const render = async (p: Props) => {
  await act(async () => root.render(createElement(Probe, p)));
};
const base = (): Props => ({
  file: new File(['a'], 'a.png'),
  options: TRACE_PRESETS.Sharp!,
  grid: { width: 4, height: 2 },
});
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  traces = [];
  vi.mocked(loadImageAsRawData).mockReset().mockResolvedValue(image);
  vi.mocked(rawImageHasTransparency).mockClear();
  vi.mocked(traceImageWithBoundaryMode)
    .mockReset()
    .mockImplementation(() => {
      const d = deferred<TraceResult>();
      traces.push(d);
      return d.promise;
    });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it('shares the exact terminal result and ignores a late preview success or failure', async () => {
  const p = base();
  await render(p);
  const settle = control.current!.capture();
  await act(async () => settle({ kind: 'ready', result: full }));
  expect(state!).toMatchObject({
    kind: 'ready',
    paths: full.paths,
    width: 4,
    height: 2,
    sourceHasTransparency: true,
  });
  if (state!.kind === 'ready') {
    expect(state.preparedTrace?.result).toBe(full);
    expect(state.preparedTrace?.request.file).toBe(p.file);
  }
  await act(async () => traces[0]!.reject(new Error('older preview failure')));
  expect(state!.kind).toBe('ready');
  expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(1);
});

it('can retry an error in the same request and settle a completed empty result', async () => {
  await render(base());
  await act(async () =>
    control.current!.capture()({ kind: 'error', error: new Error('first failure') }),
  );
  expect(state!).toEqual({ kind: 'error', message: 'first failure' });
  await act(async () => control.current!.capture()({ kind: 'ready', result: empty }));
  expect(state!).toMatchObject({ kind: 'ready', paths: [] });
  await act(async () => traces[0]!.resolve(full));
  expect(state!).toMatchObject({ kind: 'ready', paths: [] });
});

it('does not publish an expected supersession as an error', async () => {
  await render(base());
  await act(async () =>
    control.current!.capture()({ kind: 'error', error: new TraceRequestSupersededError() }),
  );
  expect(state!.kind).toBe('tracing');
  await act(async () => traces[0]!.resolve(full));
  expect(state!.kind).toBe('ready');
});

for (const changed of ['options', 'boundary', 'mode', 'grid', 'file', 'null'] as const)
  it(`a successor ${changed} rejects the captured commit settlement`, async () => {
    const p = base();
    await render(p);
    const settle = control.current!.capture();
    const next: Props = { ...p };
    if (changed === 'options') next.options = { ...p.options, thresholdLuma: 129 };
    if (changed === 'boundary') next.boundary = { x: 1, y: 0, width: 2, height: 2 };
    if (changed === 'mode') next.mode = 'enhance';
    if (changed === 'grid') next.grid = { width: 8, height: 4 };
    if (changed === 'file') next.file = new File(['b'], 'b.png');
    if (changed === 'null') next.file = null;
    await render(next);
    const before = state!;
    await act(async () => settle({ kind: 'ready', result: empty }));
    expect(state!).toBe(before);
    await act(async () => settle({ kind: 'error', error: new Error('stale commit failure') }));
    expect(state!).toBe(before);
    if (changed === 'null') {
      expect(state!.kind).toBe('idle');
      return;
    }
    if (changed !== 'file') await act(async () => vi.advanceTimersByTime(300));
    await act(async () => traces.at(-1)!.resolve(full));
    expect(state!.kind).toBe('ready');
    if (state!.kind === 'ready') expect(state.preparedTrace?.request.options).toBe(next.options);
  });

it('preserves 299/300ms debounce and no-op renders while a newer request wins', async () => {
  const p = base();
  await render(p);
  const settle = control.current!.capture();
  await render(p);
  expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(1);
  const next = { ...p, options: { ...p.options, thresholdLuma: 129 } };
  await render(next);
  await act(async () => vi.advanceTimersByTime(299));
  expect(traces).toHaveLength(1);
  await act(async () => settle({ kind: 'ready', result: empty }));
  expect(state!.kind).toBe('tracing');
  await act(async () => vi.advanceTimersByTime(1));
  expect(traces).toHaveLength(2);
  await act(async () => traces[1]!.resolve(full));
  expect(state!.kind).toBe('ready');
  expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
  expect(rawImageHasTransparency).toHaveBeenCalledTimes(1);
});

it('a current commit completion consumes the matching queued debounce without restarting work', async () => {
  const p = base();
  await render(p);
  await render({ ...p, options: { ...p.options, thresholdLuma: 129 } });
  await act(async () => vi.advanceTimersByTime(299));
  const settle = control.current!.capture();
  await act(async () => settle({ kind: 'ready', result: empty }));
  await act(async () => vi.advanceTimersByTime(1));
  expect(traces).toHaveLength(1);
  expect(state!).toMatchObject({ kind: 'ready', paths: [] });
});

for (const failure of [false, true])
  it(`settlement during pending preview decode preserves its pixels and alpha cache, failure=${failure}`, async () => {
    const decode = deferred<RawImageData>();
    vi.mocked(loadImageAsRawData).mockReturnValueOnce(decode.promise);
    const p = base();
    await render(p);
    expect(state!.kind).toBe('decoding');
    await act(async () =>
      control.current!.capture()(
        failure
          ? { kind: 'error', error: new Error('commit failure') }
          : { kind: 'ready', result: empty },
      ),
    );
    await act(async () => decode.resolve(image));
    expect(state!.kind).toBe(failure ? 'error' : 'ready');
    if (state!.kind === 'ready') expect(state.sourceHasTransparency).toBe(true);
    expect(traces).toHaveLength(0);
    await render({ ...p, options: { ...p.options, thresholdLuma: 129 } });
    await act(async () => vi.advanceTimersByTime(300));
    expect(traces).toHaveLength(1);
    await act(async () => traces[0]!.resolve(full));
    expect(state!).toMatchObject({ kind: 'ready', sourceHasTransparency: true });
    expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
    expect(rawImageHasTransparency).toHaveBeenCalledTimes(1);
  });

it('only the latest capture can settle a current request', async () => {
  await render(base());
  const old = control.current!.capture(),
    latest = control.current!.capture();
  await act(async () => latest({ kind: 'ready', result: full }));
  const ready = state!;
  await act(async () => old({ kind: 'error', error: new Error('older submission') }));
  expect(state!).toBe(ready);
});

it('unmount invalidates a captured result and pending decoder', async () => {
  const decode = deferred<RawImageData>();
  vi.mocked(loadImageAsRawData).mockReturnValueOnce(decode.promise);
  await render(base());
  const settle = control.current!.capture();
  await act(async () => root.unmount());
  const last = state!;
  await act(async () => {
    settle({ kind: 'ready', result: empty });
    decode.resolve(image);
  });
  expect(state!).toBe(last);
  expect(traces).toHaveLength(0);
  root = createRoot(host);
});
