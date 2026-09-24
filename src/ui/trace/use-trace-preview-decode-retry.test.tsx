import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { loadImageAsRawData } from './image-loader';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { resolveTraceCommitResult } from './trace-commit-result';
import { useTracePreview, type TracePreviewState } from './use-trace-preview';
import type { TracePreviewCommitControl } from './use-trace-preview-settlement';

vi.mock('./image-loader', () => ({ PREVIEW_MAX_EDGE_PX: 2048, loadImageAsRawData: vi.fn() }));
vi.mock('./region-enhance-trace', () => ({ traceImageWithBoundaryMode: vi.fn() }));

let root: Root | undefined;
let state: TracePreviewState;
const control = createRef<TracePreviewCommitControl>();
const file = new File(['pixels'], 'retry.png');
const image = { width: 4, height: 3, data: new Uint8ClampedArray(48).fill(255) };
const result = {
  paths: [],
  width: 4,
  height: 3,
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
};

function Probe(props: { file: File; options: TraceOptions }) {
  state = useTracePreview(props.file, props.options, null, 'crop', undefined, control);
  return null;
}

async function render(options: TraceOptions, source = file) {
  await act(async () => root!.render(createElement(Probe, { file: source, options })));
  await act(async () => vi.advanceTimersByTimeAsync(300));
}

async function initialFailure() {
  vi.mocked(loadImageAsRawData).mockRejectedValueOnce(new Error('transient decode failure'));
  await render(TRACE_PRESETS.Sharp!);
  expect(state!.kind).toBe('error');
  expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.mocked(loadImageAsRawData).mockReset().mockResolvedValue(image);
  vi.mocked(traceImageWithBoundaryMode).mockReset().mockResolvedValue(result);
  root = createRoot(document.createElement('div'));
});

afterEach(async () => {
  if (root !== undefined) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
});

it('retries a rejected decoder only for a later request and keeps the successful decode', async () => {
  await initialFailure();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
  await render(TRACE_PRESETS['Line Art']!);
  expect(state!.kind).toBe('ready');
  expect(loadImageAsRawData).toHaveBeenCalledTimes(2);
  await render(TRACE_PRESETS.Sharp!);
  expect(state!.kind).toBe('ready');
  expect(loadImageAsRawData).toHaveBeenCalledTimes(2);
  expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(2);
});

it('does not resurrect a rejected decoder after an empty Submit retry succeeds', async () => {
  await initialFailure();
  const settle = control.current!.capture();
  const committed = await resolveTraceCommitResult({
    file,
    options: TRACE_PRESETS.Sharp!,
    boundary: null,
    boundaryMode: 'crop',
  });
  await act(async () => settle({ kind: 'ready', result: committed }));
  expect(state!.kind).toBe('ready');
  expect(loadImageAsRawData).toHaveBeenCalledTimes(2);
  await render(TRACE_PRESETS['Line Art']!);
  expect(state!.kind).toBe('ready');
  expect(loadImageAsRawData).toHaveBeenCalledTimes(3);
  // The earlier valid empty result remains a cache hit after decode recovery.
  await render(TRACE_PRESETS.Sharp!);
  expect(state!.kind).toBe('ready');
  expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(2);
  if (state!.kind === 'ready') expect(state.sourceHasTransparency).toBe(false);
});

it('shares one pending replacement decode across further preset changes', async () => {
  await initialFailure();
  let finish!: (value: typeof image) => void;
  vi.mocked(loadImageAsRawData).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render(TRACE_PRESETS['Line Art']!);
  await render(TRACE_PRESETS['Photo shading']!);
  expect(loadImageAsRawData).toHaveBeenCalledTimes(2);
  expect(state!.kind).toBe('decoding');
  await act(async () => finish(image));
  expect(state!.kind).toBe('ready');
  expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(1);
  expect(vi.mocked(traceImageWithBoundaryMode).mock.calls[0]![1]).toBe(
    TRACE_PRESETS['Photo shading'],
  );
});

it.each(['unmount', 'new-file'] as const)(
  'aborts the replacement decoder on %s and ignores late pixels',
  async (end) => {
    await initialFailure();
    let finish!: (value: typeof image) => void;
    vi.mocked(loadImageAsRawData).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render(TRACE_PRESETS['Line Art']!);
    expect(loadImageAsRawData).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(loadImageAsRawData).mock.calls[1]![2]!;
    expect(signal.aborted).toBe(false);
    if (end === 'unmount') {
      await act(async () => root!.unmount());
      root = undefined;
    } else {
      await render(TRACE_PRESETS['Line Art']!, new File(['other'], file.name));
      expect(state!.kind).toBe('ready');
    }
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ...image, width: 999 }));
    expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(end === 'unmount' ? 0 : 1);
    if (end === 'new-file' && state!.kind === 'ready') expect(state.width).toBe(4);
  },
);
