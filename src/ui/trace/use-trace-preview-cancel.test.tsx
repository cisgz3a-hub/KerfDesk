import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import { loadImageAsRawData } from './image-loader';
import { useTracePreview } from './use-trace-preview';
import { traceImageWithFallback } from './use-trace-worker-client';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(),
}));
vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(),
  isTraceRequestSuperseded: (error: unknown) =>
    error instanceof Error && error.name === 'TraceRequestSupersededError',
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('aborts its pending preview when the dialog unmounts', async () => {
  vi.mocked(loadImageAsRawData).mockResolvedValue({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(16),
  });
  vi.mocked(traceImageWithFallback).mockImplementation(
    (_image, _options, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('Preview closed');
          error.name = 'TraceRequestSupersededError';
          reject(error);
        });
      }),
  );
  const root = createRoot(document.createElement('div'));
  const file = new File(['image'], 'logo.png', { type: 'image/png' });
  function Preview(): null {
    useTracePreview(file, TRACE_PRESETS.Sharp!);
    return null;
  }
  await act(async () => root.render(createElement(Preview)));
  const signal = vi.mocked(traceImageWithFallback).mock.calls[0]?.[2];
  expect(signal?.aborted).toBe(false);
  await act(async () => root.unmount());
  expect(signal?.aborted).toBe(true);
});
