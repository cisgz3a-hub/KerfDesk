import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import { useTracePreview, type TracePreviewState } from './use-trace-preview';
import { loadImageAsRawData } from './image-loader';
import { traceImageWithBoundaryMode } from './region-enhance-trace';

vi.mock('./image-loader', () => ({ PREVIEW_MAX_EDGE_PX: 2048, loadImageAsRawData: vi.fn() }));
vi.mock('./region-enhance-trace', () => ({ traceImageWithBoundaryMode: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('keeps one elapsed start across decode and actual phases and ignores repeated status', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(5000);
  let decode!: (image: RawImageData) => void;
  vi.mocked(loadImageAsRawData).mockReturnValue(
    new Promise((resolve) => {
      decode = resolve;
    }),
  );
  vi.mocked(traceImageWithBoundaryMode).mockReturnValue(new Promise(() => undefined));
  const file = new File(['image'], 'source.png');
  let state: TracePreviewState = { kind: 'idle' };
  function Probe() {
    state = useTracePreview(file, TRACE_PRESETS.Sharp!);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(state).toEqual({ kind: 'decoding', startedAt: 5000 });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      decode({ width: 2, height: 2, data: new Uint8ClampedArray(16) });
    });
    expect(state).toMatchObject({ kind: 'tracing', phase: 'preparing', startedAt: 5000 });
    const progress = vi.mocked(traceImageWithBoundaryMode).mock.calls[0]?.[5];
    expect(progress).toBeTypeOf('function');
    const prior = state;
    await act(async () => progress?.('preparing'));
    expect(state).toBe(prior);
    await act(async () => progress?.('tracing'));
    expect(state).toMatchObject({ kind: 'tracing', phase: 'tracing', startedAt: 5000 });
    await act(async () => progress?.('refining'));
    expect(state).toMatchObject({ kind: 'tracing', phase: 'refining', startedAt: 5000 });
  } finally {
    await act(async () => root.unmount());
  }
});
