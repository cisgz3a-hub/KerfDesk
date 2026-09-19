import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextRenderResult } from '../../core/text/text-to-polylines';
import { applyTextWeldInWorker } from './text-weld-worker-client';
import type { TextWeldWorkerResponse } from './text-weld-worker-protocol';

const rendered: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
  paths: [
    {
      color: '#123456',
      polylines: [0, 5].map((x) => ({
        closed: true,
        points: [
          { x, y: 0 },
          { x: x + 10, y: 0 },
          { x: x + 10, y: 10 },
          { x, y: 10 },
        ],
      })),
    },
  ],
};

class WorkerHarness {
  onmessage: ((event: MessageEvent<TextWeldWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  reply(response: TextWeldWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<TextWeldWorkerResponse>);
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('owned text outline worker', () => {
  it('dispatches the exact placed geometry and releases the worker after its result', async () => {
    const worker = install();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = applyTextWeldInWorker(rendered, 'great-vibes-regular', true, controller.signal);
    expect(worker.postMessage).toHaveBeenCalledWith(rendered);
    const result = { ...rendered, paths: [] };
    worker.reply({ kind: 'ok', value: result });
    expect(await pending).toBe(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(worker.onmessage).toBeNull();
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates unfinished work immediately and ignores a late retired response', async () => {
    const worker = install();
    const controller = new AbortController();
    const pending = applyTextWeldInWorker(rendered, 'great-vibes-regular', true, controller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const lateReply = worker.onmessage;
    controller.abort();
    await cancelled;
    expect(worker.terminate).toHaveBeenCalledOnce();
    lateReply?.({ data: { kind: 'ok', value: rendered } } as MessageEvent<TextWeldWorkerResponse>);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not start a worker for cancelled work or native single-line/disabled outlines', async () => {
    const worker = install();
    const controller = new AbortController();
    controller.abort();
    await expect(
      applyTextWeldInWorker(rendered, 'great-vibes-regular', true, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await applyTextWeldInWorker(rendered, 'ems-nixish', true)).toBe(rendered);
    expect(await applyTextWeldInWorker(rendered, 'great-vibes-regular', false)).toBe(rendered);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(Worker).not.toHaveBeenCalled();
  });

  it.each(['onerror', 'onmessageerror', 'postMessage'] as const)(
    'reports %s failures and disposes without running a main-thread union',
    async (failure) => {
      const worker = install();
      if (failure === 'postMessage')
        worker.postMessage.mockImplementation(() => {
          throw new Error('clone failed');
        });
      const pending = applyTextWeldInWorker(rendered, 'great-vibes-regular', true);
      const failed = expect(pending).rejects.toThrow('Text outline processing failed');
      if (failure !== 'postMessage') worker[failure]?.();
      await failed;
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );

  it('reports geometry errors without treating the original outlines as welded', async () => {
    const worker = install();
    const pending = applyTextWeldInWorker(rendered, 'great-vibes-regular', true);
    const failed = expect(pending).rejects.toThrow('No outlines remain');
    worker.reply({ kind: 'error', error: { kind: 'empty-result', message: 'No outlines remain' } });
    await failed;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('never falls back when worker construction fails', async () => {
    vi.stubGlobal(
      'Worker',
      vi.fn(() => {
        throw new Error('worker blocked');
      }),
    );
    await expect(applyTextWeldInWorker(rendered, 'great-vibes-regular', true)).rejects.toThrow(
      'Text outline processing failed',
    );
  });

  it('permits deterministic SSR only when Worker is absent, and rejects absence in browsers', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubEnv('SSR', true);
    const result = await applyTextWeldInWorker(rendered, 'great-vibes-regular', true);
    expect(result.paths[0]?.polylines).toHaveLength(1);
    expect(result.bounds).toEqual(rendered.bounds);
    vi.stubEnv('SSR', false);
    vi.stubEnv('MODE', 'production');
    await expect(applyTextWeldInWorker(rendered, 'great-vibes-regular', true)).rejects.toThrow(
      'Text outline processing failed',
    );
  });
});
