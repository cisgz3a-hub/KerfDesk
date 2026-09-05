import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { buildGcodeMetadata } from '../app/build-info';
import { startSurfacingStream } from './surfacing-worker-client';
import type {
  PreparedSurfacing,
  SurfacingWorkerInput,
  SurfacingWorkerResponse,
} from './surfacing-worker-protocol';

const input: SurfacingWorkerInput = {
  params: {
    widthMm: 100,
    heightMm: 99999,
    bitDiameterMm: 1,
    stepoverPct: 100,
    depthPerPassMm: 0.5,
    totalDepthMm: 49999.5,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 5,
  },
  device: DEFAULT_DEVICE_PROFILE,
  machine: DEFAULT_CNC_MACHINE_CONFIG,
  metadata: buildGcodeMetadata(),
};
const prepared: PreparedSurfacing = {
  summary: {
    passes: 99999,
    rowsPerPass: 100000,
    requestedTotalDepthMm: 49999.5,
    emittedMaximumDepthMm: 49999.5,
    emittedMaximumDepthText: '49999.500',
  },
  preflight: { ok: true, issues: [] },
};
class WorkerHarness {
  onmessage: ((event: MessageEvent<SurfacingWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  reply(response: SurfacingWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<SurfacingWorkerResponse>);
  }
}
function install(): WorkerHarness {
  const worker = new WorkerHarness();
  vi.stubGlobal(
    'Worker',
    vi.fn(function Worker() {
      return worker;
    }),
  );
  return worker;
}
afterEach(() => vi.unstubAllGlobals());

describe('owned surfacing stream worker', () => {
  it('terminates a huge unfinished preflight promptly when cancelled', async () => {
    const worker = install();
    const controller = new AbortController();
    const task = startSurfacingStream(input, controller.signal);
    const cancelled = expect(task.ready).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.postMessage).toHaveBeenCalledWith({ kind: 'prepare', input });
    controller.abort();
    await cancelled;
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.reply({ kind: 'ready', prepared }); // a retired worker cannot revive the job
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('pulls one chunk at a time and cancels an outstanding pull', async () => {
    const worker = install();
    const controller = new AbortController();
    const task = startSurfacingStream(input, controller.signal);
    worker.reply({ kind: 'ready', prepared });
    await task.ready;
    const chunks = task.chunks[Symbol.asyncIterator]();
    const first = chunks.next();
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenLastCalledWith({ kind: 'next' });
    worker.reply({ kind: 'chunk', text: 'G21\n', done: false });
    expect(await first).toEqual({ value: 'G21\n', done: false });
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const second = chunks.next();
    await Promise.resolve();
    const cancelled = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await cancelled;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('surfaces a worker error and retires its resources', async () => {
    const worker = install();
    const task = startSurfacingStream(input, new AbortController().signal);
    const failed = expect(task.ready).rejects.toThrow('generation failed');
    worker.reply({ kind: 'error', message: 'generation failed' });
    await failed;
    expect(worker.terminate).toHaveBeenCalledOnce();
    task.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
