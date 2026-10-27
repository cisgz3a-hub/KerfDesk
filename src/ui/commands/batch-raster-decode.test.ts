// @vitest-environment node
// Multi-File Trace decodes TIFF and Netpbm scans, and resamples them, in the
// import worker (ADR-357 Amendment 2, rolling audit v5 J6-P2-3): on the UI
// thread a 24 MP TIFF froze the window, and Abort with it, for 15-24 s.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { decodeBatchRasterBytes, resampleBatchRaster } from '../import/batch-raster-pixels';
import { resetImportWorkerForTests } from '../import/import-worker-client';
import type { ImportWorkerRequest, ImportWorkerResponse } from '../import/import-worker-protocol';
import { decodeBatchRasterFile, sampleBatchRaster } from './batch-raster-decode';
import { buildMultiFileTraceExports } from './multi-file-trace-action';

// Answers as import-worker.ts does, unless told to hold the request.
class FakeImportWorker {
  static instances: FakeImportWorker[] = [];
  static hold = false;
  onmessage: ((event: MessageEvent<ImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: ImportWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeImportWorker.instances.push(this);
  }

  postMessage(request: ImportWorkerRequest): void {
    this.posted.push(request);
    if (FakeImportWorker.hold) return;
    void answer(request).then((data) => {
      if (!this.terminated) this.onmessage?.({ data } as MessageEvent<ImportWorkerResponse>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

async function answer(request: ImportWorkerRequest): Promise<ImportWorkerResponse> {
  if (request.kind === 'batch-raster') {
    const bytes = new Uint8Array(await request.blob.arrayBuffer());
    return {
      id: request.id,
      kind: 'batch-raster',
      result: decodeBatchRasterBytes(bytes, request.format),
    };
  }
  if (request.kind === 'resample-rgba') {
    const { image, width, height } = request;
    const result = resampleBatchRaster({ ...image, rgba: image.data }, width, height);
    return { id: request.id, kind: 'resample-rgba', result };
  }
  return { id: request.id, kind: 'error', message: `unexpected ${request.kind}` };
}

function posted(): ImportWorkerRequest['kind'][] {
  return FakeImportWorker.instances.flatMap((worker) => worker.posted.map((item) => item.kind));
}

function pbmFile(): File {
  return new File([new TextEncoder().encode('P1\n4 2\n1100\n0011\n')], 'scan.pbm');
}

const SQUARE: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  ],
};

describe('Multi-File Trace scans decode off the UI thread', () => {
  beforeEach(() => {
    FakeImportWorker.instances = [];
    FakeImportWorker.hold = false;
    vi.stubGlobal('Worker', FakeImportWorker);
  });

  afterEach(() => {
    resetImportWorkerForTests();
    vi.unstubAllGlobals();
  });

  it('decodes and resamples a scan in the import worker', async () => {
    const raster = await decodeBatchRasterFile(pbmFile());
    expect(raster).toMatchObject({ width: 4, height: 2, sizeMm: null });
    if (raster === null) return;
    const sampled = await sampleBatchRaster(raster, 2);

    expect([sampled.width, sampled.height]).toEqual([2, 1]);
    expect(posted()).toEqual(['batch-raster', 'resample-rgba']);
    // The caller keeps its own decode: the worker resamples a copy.
    expect(raster.rgba.byteLength).toBe(4 * 2 * 4);
  });

  it('traces a batch with every decode and resample in the worker', async () => {
    const traced: Array<[number, number]> = [];
    const batch = await buildMultiFileTraceExports([pbmFile()], {
      trace: async (image) => {
        traced.push([image.width, image.height]);
        return [SQUARE];
      },
    });

    expect(batch.files.map((file) => file.filename)).toEqual(['scan-trace.svg']);
    expect(traced).toEqual([[4, 2]]);
    expect(posted()).toEqual(['batch-raster', 'resample-rgba']);
  });

  it('stops the worker when the batch is cancelled mid-decode', async () => {
    FakeImportWorker.hold = true;
    const controller = new AbortController();
    const batch = buildMultiFileTraceExports([pbmFile()], {
      signal: controller.signal,
      trace: async () => [SQUARE],
    });
    await vi.waitFor(() => expect(posted()).toEqual(['batch-raster']));

    controller.abort();

    await expect(batch).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeImportWorker.instances[0]?.terminated).toBe(true);
  });
});
