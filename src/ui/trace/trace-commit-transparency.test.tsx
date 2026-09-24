import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import { loadImageAsRawData } from './image-loader';
import { rawImageHasTransparency } from './raw-image-transparency';
import { resolveTraceCommitResult } from './trace-commit-result';
import { TraceSettingsControls } from './TraceSettingsControls';
import { useTracePreview, type TracePreviewState } from './use-trace-preview';
import type { TracePreviewCommitControl } from './use-trace-preview-settlement';
import { traceImageWithFallback } from './use-trace-worker-client';

vi.mock('./image-loader', () => ({ PREVIEW_MAX_EDGE_PX: 2048, loadImageAsRawData: vi.fn() }));
vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(),
  isTraceRequestSuperseded: () => false,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root !== undefined) await act(async () => root!.unmount());
  root = undefined;
});

it.each([true, false])(
  'publishes full-source transparency=%s immediately after an empty Submit retry',
  async (transparent) => {
    const image = { width: 4, height: 3, data: new Uint8ClampedArray(48).fill(255) };
    // The only transparent pixel lies outside the trace crop.
    if (transparent) image.data[3] = 0;
    vi.mocked(loadImageAsRawData)
      .mockReset()
      .mockRejectedValueOnce(new Error('transient preview decode failure'))
      .mockResolvedValue(image);
    vi.mocked(traceImageWithFallback)
      .mockReset()
      .mockImplementation((cropped) =>
        Promise.resolve({
          paths: [],
          width: cropped.width,
          height: cropped.height,
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        }),
      );
    const request = {
      file: new File(['image'], 'retry.png'),
      options: TRACE_PRESETS.Sharp!,
      boundary: { x: 2, y: 1, width: 1, height: 1 },
      boundaryMode: 'crop' as const,
    };
    const control = createRef<TracePreviewCommitControl>();
    const changes = vi.fn();
    let preview: TracePreviewState = { kind: 'idle' };
    function Probe() {
      preview = useTracePreview(
        request.file,
        request.options,
        request.boundary,
        request.boundaryMode,
        undefined,
        control,
      );
      return (
        <TraceSettingsControls
          preset={request.options}
          overrides={{}}
          sourceHasTransparency={
            preview.kind === 'ready' ? preview.sourceHasTransparency : undefined
          }
          onChange={changes}
        />
      );
    }
    const host = document.createElement('div');
    root = createRoot(host);
    await act(async () => root!.render(<Probe />));
    expect(preview.kind).toBe('error');
    const settle = control.current!.capture();
    const result = await resolveTraceCommitResult(request);
    await act(async () => settle({ kind: 'ready', result }));
    const ready = preview as TracePreviewState;
    expect(ready.kind).toBe('ready');
    if (ready.kind !== 'ready') throw new Error('Retry did not settle');
    expect(ready.paths).toHaveLength(0);
    expect(ready.sourceHasTransparency).toBe(transparent);
    const alpha = host.querySelector<HTMLInputElement>('[aria-label="Trace alpha mask"]');
    expect(alpha).not.toBeNull();
    expect(alpha!.disabled).toBe(!transparent);
    expect(host.textContent).not.toContain('Checking image transparency');
    if (transparent) {
      await act(async () => alpha!.click());
      expect(changes).toHaveBeenCalledWith(expect.objectContaining({ traceTransparency: true }));
    }
    expect(rawImageHasTransparency(vi.mocked(traceImageWithFallback).mock.calls[0]![0])).toBe(
      false,
    );
    expect(
      await resolveTraceCommitResult({ ...request, preparedTrace: ready.preparedTrace! }),
    ).toBe(result);
    expect(ready.preparedTrace?.result).toBe(result);
    expect(loadImageAsRawData).toHaveBeenCalledTimes(2);
    expect(traceImageWithFallback).toHaveBeenCalledTimes(1);
  },
);
