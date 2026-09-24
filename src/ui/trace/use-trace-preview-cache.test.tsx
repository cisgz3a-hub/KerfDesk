import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { loadImageAsRawData } from './image-loader';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { useTracePreview, type TracePreviewState } from './use-trace-preview';
import type { TracePreviewCommitControl } from './use-trace-preview-settlement';
import { matchingPreparedTrace } from './prepared-trace';

vi.mock('./image-loader', () => ({ PREVIEW_MAX_EDGE_PX: 2048, loadImageAsRawData: vi.fn() }));
vi.mock('./region-enhance-trace', () => ({ traceImageWithBoundaryMode: vi.fn() }));

let root: Root;
let state: TracePreviewState;
const control = createRef<TracePreviewCommitControl>();
const result = {
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 1 },
            { x: 3, y: 1 },
          ],
        },
      ],
    },
  ],
  bounds: { minX: 0, minY: 1, maxX: 3, maxY: 1 },
  width: 4,
  height: 3,
};
function Probe(props: { file: File; options: TraceOptions }) {
  state = useTracePreview(
    props.file,
    props.options,
    null,
    'crop',
    { width: 4, height: 3 },
    control,
  );
  return null;
}
async function render(file: File, options: TraceOptions) {
  await act(async () => root.render(createElement(Probe, { file, options })));
  await act(async () => vi.advanceTimersByTimeAsync(300));
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.mocked(loadImageAsRawData)
    .mockReset()
    .mockResolvedValue({ width: 4, height: 3, data: new Uint8ClampedArray(48).fill(255) });
  vi.mocked(traceImageWithBoundaryMode).mockReset().mockResolvedValue(result);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

it('reuses a visited preset with new option references and preserves Submit matching', async () => {
  const file = new File(['image'], 'portrait.png');
  await render(file, { ...TRACE_PRESETS['Line Art']! });
  const first = state!;
  await render(file, { ...TRACE_PRESETS['Photo shading']! });
  const returnedOptions = { ...TRACE_PRESETS['Line Art']!, fixedPalette: ['#ffffff', '#000000'] };
  await render(file, returnedOptions);
  expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
  expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(2);
  if (state!.kind !== 'ready' || first.kind !== 'ready') throw Error('Preview was not ready');
  expect(state.svg).toBe(first.svg);
  expect(state.paths).toBe(first.paths);
  expect(state.preparedTrace?.request.options).toBe(returnedOptions);
  expect(
    matchingPreparedTrace(state.preparedTrace, {
      file,
      options: returnedOptions,
      boundary: null,
      boundaryMode: 'crop',
      sourceGrid: { width: 4, height: 3 },
    }),
  ).toBe(result);
});

it('clears visited results when a different File opens even if its name matches', async () => {
  const file = new File(['image'], 'portrait.png');
  await render(file, TRACE_PRESETS.Sharp!);
  await render(new File(['other'], file.name), TRACE_PRESETS.Sharp!);
  expect(loadImageAsRawData).toHaveBeenCalledTimes(2);
  expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(2);
});

it('never retains a failed preparation as a visited result', async () => {
  vi.mocked(traceImageWithBoundaryMode).mockRejectedValueOnce(new Error('temporary failure'));
  const file = new File(['image'], 'portrait.png');
  await render(file, TRACE_PRESETS.Sharp!);
  expect(state!.kind).toBe('error');
  await render(file, TRACE_PRESETS['Photo shading']!);
  await render(file, TRACE_PRESETS.Sharp!);
  expect(state!.kind).toBe('ready');
  expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(3);
});
