// What automatic detection chose travels with the trace result on both
// routes: from the worker's 'ok' message and from the cooperative inline
// fallback. The dialog shows it and starts a Manual band from it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, cropRawImageData, type RawImageData } from '../../core/trace';
import { otsuThreshold } from '../../core/trace/preprocess';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trace results carry the trace report', () => {
  it('keeps the report a worker sent', async () => {
    vi.resetModules();
    class ReportingWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;

      postMessage(request: TraceWorkerRequest): void {
        const response: TraceWorkerResponse = {
          id: request.id,
          kind: 'ok',
          paths: [],
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          width: request.image.width,
          height: request.image.height,
          report: { automaticThresholdLuma: 97 },
        };
        queueMicrotask(() => {
          this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
        });
      }

      terminate(): void {
        /* a healthy worker is reused */
      }
    }
    vi.stubGlobal('Worker', ReportingWorker);
    const client = await import('./use-trace-worker-client');

    const result = await client.traceImage(barsImage(), TRACE_PRESETS['Sharp']!);

    expect(result.report).toEqual({ automaticThresholdLuma: 97 });
  });

  it('collects the report on the inline fallback', async () => {
    vi.resetModules();
    const client = await import('./use-trace-worker-client');
    const image = barsImage();

    const result = await client.traceImage(image, TRACE_PRESETS['Sharp']!);

    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.report).toEqual({ automaticThresholdLuma: otsuThreshold(image) });
  });

  it('keeps the cropped trace report through a Crop region', async () => {
    vi.resetModules();
    const { traceImageRegion } = await import('./trace-region');
    const image = barsImage();
    const region = { x: 0, y: 0, width: 24, height: 32 };

    const result = await traceImageRegion(image, TRACE_PRESETS['Sharp']!, region);

    expect(result).toMatchObject({ width: 48, height: 32 });
    expect(result.report).toEqual({
      automaticThresholdLuma: otsuThreshold(cropRawImageData(image, region)),
    });
  });
});

// Mid-grey bars on light paper: Otsu settles well away from the 128 default.
function barsImage(): RawImageData {
  const width = 48;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const x = pixel % width;
    const grey = x % 12 < 5 ? 120 : 240;
    data.set([grey, grey, grey, 255], pixel * 4);
  }
  return { width, height, data };
}
