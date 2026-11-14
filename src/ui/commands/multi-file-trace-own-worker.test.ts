// T25-P2-1 / T25R-P2-1 (tools audit T1): Multi-File Trace and the Trace Image
// dialog used to share one trace worker, so each superseded the other. The
// batch retried at once and won, the dialog's preview and Trace press were
// dropped without a word, and a batch file the dialog interrupted was written
// at the preview grid. These run the real worker client and the real batch
// over a fake Worker that answers only when the test says so.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawImageData, TraceOptions } from '../../core/trace';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import type { TraceWorkerRequest, TraceWorkerResponse } from '../trace/trace-worker';
import { PREVIEW_MAX_EDGE_PX } from '../trace/trace-decode-cap';
import * as client from '../trace/use-trace-worker-client';
import * as action from './multi-file-trace-action';

const DIALOG_WIDTH = 601;
const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: MessageEvent<TraceWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  readonly requests: TraceWorkerRequest[] = [];
  readonly answered = new Set<number>();
  constructor() {
    workers.push(this);
  }
  postMessage(request: TraceWorkerRequest): void {
    this.requests.push(request);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(request: TraceWorkerRequest): void {
    this.answered.add(request.id);
    const { width, height } = request.image;
    const response: TraceWorkerResponse = {
      id: request.id,
      kind: 'ok',
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 1, y: 1 },
                { x: width / 2, y: 1 },
                { x: width / 2, y: height / 2 },
                { x: 1, y: height / 2 },
              ],
            },
          ],
        },
      ],
      bounds: { minX: 1, minY: 1, maxX: width / 2, maxY: height / 2 },
      width,
      height,
    };
    this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
  }
}

const isDialog = (request: TraceWorkerRequest): boolean => request.image.width === DIALOG_WIDTH;

// Request ids rise across the file; this test's requests start here. The
// dialog's (default) client keeps its worker from one test to the next.
let firstRequestId = 0;
const thisTest = (request: TraceWorkerRequest): boolean => request.id >= firstRequestId;
const usedThisTest = (worker: FakeWorker): boolean => worker.requests.some(thisTest);

function answerLive(match: (request: TraceWorkerRequest) => boolean): void {
  for (const worker of workers) {
    if (worker.terminated) continue;
    for (const request of worker.requests) {
      if (!worker.answered.has(request.id) && match(request)) worker.answer(request);
    }
  }
}

// Let the batch's and the dialog's promise chains run (decodes, retries).
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

type Settled<T> = { readonly value: T } | { readonly error: unknown };

// The dialog's trace takes a while: only after everything else has had its
// turn does the worker answer it. A trace another request superseded in the
// meantime settles as that error.
async function driveDialog<T>(work: Promise<T>): Promise<Settled<T>> {
  let settled: Settled<T> | undefined;
  void work.then(
    (value) => (settled = { value }),
    (error: unknown) => (settled = { error }),
  );
  for (let round = 0; round < 40 && settled === undefined; round += 1) {
    await flush();
    answerLive(isDialog);
  }
  if (settled === undefined) throw new Error('The dialog trace never settled');
  return settled;
}

async function finishBatch(done: Promise<void>): Promise<void> {
  let finished = false;
  void done.finally(() => (finished = true));
  for (let round = 0; round < 80 && !finished; round += 1) {
    await flush();
    answerLive(() => true);
  }
  await done;
}

function dialogImage(): RawImageData {
  return {
    width: DIALOG_WIDTH,
    height: 450,
    data: new Uint8ClampedArray(DIALOG_WIDTH * 450 * 4).fill(255),
  };
}

async function startBatch() {
  const natural = { width: 6000, height: 4000 };
  const toasts: Array<readonly [string, string | undefined]> = [];
  const written: string[] = [];
  const files = ['b1.png', 'b2.png'].map(
    (name) => new File([new Uint8Array(4)], name, { type: 'image/png' }),
  );
  const done = action.runMultiFileTrace(files, (message, kind) => toasts.push([message, kind]), {
    readNaturalSize: async () => natural,
    readDensity: async () => null,
    decodeRaster: async () => null,
    loadImage: async (_file, maxEdge) => {
      const scale = (maxEdge ?? PREVIEW_MAX_EDGE_PX) / natural.width;
      const width = Math.round(natural.width * scale);
      const height = Math.round(natural.height * scale);
      return { width, height, data: new Uint8ClampedArray(16) };
    },
    targetPxPerMm: 20,
    deviceMemoryGb: 8,
    write: async (file) => {
      written.push(file.filename);
      return true;
    },
  });
  // Wait until file 1's trace is with a worker.
  for (let round = 0; round < 40; round += 1) {
    if (batchRequests().length > 0) break;
    await flush();
  }
  expect(batchRequests()).toHaveLength(1);
  return { done, toasts, written };
}

function batchRequests(): TraceWorkerRequest[] {
  return workers.flatMap((worker) =>
    worker.requests.filter((request) => thisTest(request) && !isDialog(request)),
  );
}

beforeAll(() => {
  vi.stubGlobal('Worker', FakeWorker);
});

beforeEach(() => {
  const ids = workers.flatMap((worker) => worker.requests.map((request) => request.id));
  firstRequestId = Math.max(0, ...ids) + 1;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('Multi-File Trace traces on its own worker', () => {
  it('lets a Trace press land while a batch file traces, and the batch keeps going', async () => {
    const batch = await startBatch();

    const press = await driveDialog(client.traceImageWithFallback(dialogImage(), LINE_ART));

    expect(press).toHaveProperty('value');
    if ('value' in press) expect(press.value.paths).toHaveLength(1);
    await finishBatch(batch.done);
    expect(batch.written).toEqual(['b1-trace.svg', 'b2-trace.svg']);
    // The dialog and the batch never shared a worker.
    const dialogWorkers = workers.filter(
      (worker) => usedThisTest(worker) && worker.requests.some(isDialog),
    );
    expect(dialogWorkers).toHaveLength(1);
    expect(dialogWorkers[0]?.requests.every(isDialog)).toBe(true);
  });

  it('keeps a Trace Image preview working during a batch', async () => {
    const batch = await startBatch();
    const preview = new AbortController();

    const result = await driveDialog(
      client.traceImageWithFallback(dialogImage(), LINE_ART, preview.signal),
    );

    expect(result).toHaveProperty('value');
    await finishBatch(batch.done);
    expect(batch.written).toEqual(['b1-trace.svg', 'b2-trace.svg']);
  });

  it('keeps the full grid for a batch file the dialog traced over, and says nothing of it', async () => {
    const batch = await startBatch();

    // The refuter's scenario C: the dialog opens (its preview), then Trace is
    // pressed twice while batch file 1 is still tracing.
    const preview = new AbortController();
    const previewResult = await driveDialog(
      client.traceImageWithFallback(dialogImage(), LINE_ART, preview.signal),
    );
    const first = await driveDialog(client.traceImageWithFallback(dialogImage(), LINE_ART));
    const second = await driveDialog(client.traceImageWithFallback(dialogImage(), LINE_ART));
    await finishBatch(batch.done);

    expect([previewResult, first, second].every((settled) => 'value' in settled)).toBe(true);
    expect(batch.written).toEqual(['b1-trace.svg', 'b2-trace.svg']);
    // Every batch trace ran on the planned finer grid, none on the preview grid.
    const widths = batchRequests().map((request) => request.image.width);
    expect(widths).toHaveLength(2);
    expect(widths.every((width) => width > PREVIEW_MAX_EDGE_PX)).toBe(true);
    expect(batch.toasts).toHaveLength(1);
    expect(batch.toasts[0]?.[1]).toBe('success');
    expect(batch.toasts[0]?.[0]).not.toContain('preview resolution');
  });

  it("ends the batch's own worker when the batch finishes, and leaves the dialog's", async () => {
    const batch = await startBatch();
    await driveDialog(client.traceImageWithFallback(dialogImage(), LINE_ART));
    await finishBatch(batch.done);

    const used = workers.filter(usedThisTest);
    const batchWorkers = used.filter((worker) => !worker.requests.some(isDialog));
    expect(batchWorkers.length).toBeGreaterThan(0);
    expect(batchWorkers.every((worker) => worker.terminated)).toBe(true);
    expect(used.filter((worker) => worker.requests.some(isDialog))[0]?.terminated).toBe(false);
  });
});
