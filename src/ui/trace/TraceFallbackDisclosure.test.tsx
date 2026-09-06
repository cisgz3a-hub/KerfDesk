import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';
import { TracePreview } from './TracePreview';
import { resolveTraceCommitResult } from './trace-commit-result';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { runTrace, type TracePreviewState } from './use-trace-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('relaxed trace settings remain visible with their recovered geometry', () => {
  it('discloses a real zero-paths retry in the preview and preserves it for commit reuse', async () => {
    const image = tinySpeck();
    const options = TRACE_PRESETS['Sharp'];
    if (options === undefined) throw new Error('Missing Sharp preset');
    expect(await traceImageToColoredPaths(image, options)).toEqual([]);
    const file = new File(['source'], 'speck.png');
    const request = { file, options, boundary: null, boundaryMode: 'crop' as const };
    const states: TracePreviewState[] = [];
    await runTrace({
      img: image,
      options,
      request,
      isCurrent: () => true,
      setState: (s) => states.push(s),
    });
    const ready = states.find((state) => state.kind === 'ready');
    if (ready === undefined) throw new Error('Trace did not become ready');
    expect(ready.paths.length).toBeGreaterThan(0);
    expect(ready.notices).toEqual(['relaxed-settings']);

    const committed = await resolveTraceCommitResult({
      ...request,
      ...(ready.preparedTrace === undefined ? {} : { preparedTrace: ready.preparedTrace }),
    });
    expect(committed.paths).toBe(ready.paths);
    expect(committed.notices).toEqual(['relaxed-settings']);
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(<TracePreview state={ready} />));
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        'Automatic retry used relaxed trace settings',
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each(['crop', 'enhance'] as const)(
    'retains retry disclosure through %s tracing',
    async (mode) => {
      const options = TRACE_PRESETS['Sharp'];
      if (options === undefined) throw new Error('Missing Sharp preset');
      const result = await traceImageWithBoundaryMode(
        tinySpeck(),
        options,
        { x: 2, y: 2, width: 12, height: 12 },
        mode,
      );
      expect(result.paths.length).toBeGreaterThan(0);
      expect(result.notices).toEqual(['relaxed-settings']);
    },
  );
});

function tinySpeck(): RawImageData {
  const data = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  for (const y of [7, 8]) data.set([0, 0, 0, 255], (y * 16 + 7) * 4);
  return { width: 16, height: 16, data };
}
