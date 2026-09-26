// Region Enhance asks the worker to resolve the whole source's binarisation
// decisions next to the full trace (ADR-410), so the UI thread never pays for
// the full-image median and histogram they need.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawImageData, TraceOptions } from '../../core/trace';
import { resolveFrozenTraceSourceOptions } from '../../core/trace/trace-source-decisions';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

const mocks = vi.hoisted(() => ({
  trace: vi.fn(async () => []),
  bounds: vi.fn(() => ({ minX: 0, minY: 0, maxX: 1, maxY: 1 })),
}));
vi.mock('../../core/trace', () => ({
  traceImageToColoredPaths: mocks.trace,
  boundsFromColoredPaths: mocks.bounds,
}));

const options: TraceOptions = {
  numberOfColors: 2,
  pathOmit: 0,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: false,
  fixedPalette: ['#ffffff', '#000000'],
  useOtsuThreshold: true,
};

// Dark ink on mid-grey paper: Otsu's cut is neither 0 nor the default 128.
function image(): RawImageData {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let p = 0; p < 64; p += 1) {
    const v = p % 5 === 0 ? 30 : 190;
    data.set([v, v, v, 255], p * 4);
  }
  return { width: 8, height: 8, data };
}

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.trace.mockClear();
});

async function send(request: TraceWorkerRequest): Promise<TraceWorkerResponse[]> {
  const posted: TraceWorkerResponse[] = [];
  const scope = {
    onmessage: null as ((event: MessageEvent<TraceWorkerRequest>) => void) | null,
    postMessage: (response: TraceWorkerResponse) => posted.push(response),
  };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./trace-worker');
  scope.onmessage?.({ data: request } as MessageEvent<TraceWorkerRequest>);
  await Promise.resolve();
  await Promise.resolve();
  return posted;
}

describe('trace worker source decisions (ADR-410)', () => {
  it('traces with the frozen options and returns them when asked', async () => {
    const source = image();
    const frozen = resolveFrozenTraceSourceOptions(source, options);
    expect(frozen.sourceOtsuThreshold).toBeDefined();

    const posted = await send({ id: 3, image: source, options, freezeSourceDecisions: true });

    expect(mocks.trace).toHaveBeenCalledWith(
      source,
      frozen,
      expect.any(Function),
      expect.any(Function),
    );
    expect(posted.at(-1)).toMatchObject({ id: 3, kind: 'ok', sourceOptions: frozen });
  });

  it('leaves an ordinary request untouched', async () => {
    const source = image();

    const posted = await send({ id: 4, image: source, options });

    expect(mocks.trace).toHaveBeenCalledWith(
      source,
      options,
      expect.any(Function),
      expect.any(Function),
    );
    expect(posted.at(-1)).toMatchObject({ id: 4, kind: 'ok' });
    expect(posted.at(-1)).not.toHaveProperty('sourceOptions');
  });
});
