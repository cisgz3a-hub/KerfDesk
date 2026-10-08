import { describe, expect, it, vi } from 'vitest';
import { createBlankReliefAuthoringDocument } from '../../core/relief/relief-authoring-document';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';
import { isOwnedReliefComposition } from '../../core/relief/relief-authoring-composition-proof';
import { composeReliefInWorker } from './relief-authoring-worker-client';

function fixture() {
  const document = createBlankReliefAuthoringDocument({
    width: 2,
    height: 2,
    physicalWidthMm: 4,
    physicalHeightMm: 4,
    maxDepthMm: 5,
  });
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  } as unknown as Pick<Worker, 'onmessage' | 'onerror' | 'postMessage' | 'terminate'>;
  return { document, worker, owner: { createWorker: () => worker } };
}

describe('relief worker ownership', () => {
  it('terminates the owner on abort and ignores late results and proof publication', async () => {
    const { document, worker, owner } = fixture();
    const controller = new AbortController();
    const promise = composeReliefInWorker(document, controller.signal, undefined, owner);
    const late = worker.onmessage;
    const result = materializeReliefAuthoring(document);
    controller.abort();
    expect(await promise).toEqual({ kind: 'cancelled' });
    late?.call(worker as Worker, new MessageEvent('message', { data: { kind: 'result', result } }));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    if (result.kind === 'ok') expect(isOwnedReliefComposition(document, result.field)).toBe(false);
  });
  it('records proof only for the exact successful request objects and disposes worker', async () => {
    const { document, worker, owner } = fixture();
    const controller = new AbortController();
    const progress = vi.fn();
    const promise = composeReliefInWorker(document, controller.signal, progress, owner);
    const result = materializeReliefAuthoring(document);
    worker.onmessage?.call(
      worker as Worker,
      new MessageEvent('message', { data: { kind: 'progress', fraction: 0.5 } }),
    );
    worker.onmessage?.call(
      worker as Worker,
      new MessageEvent('message', { data: { kind: 'result', result } }),
    );
    expect(await promise).toEqual(result);
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(worker.terminate).toHaveBeenCalledOnce();
    if (result.kind === 'ok') {
      expect(isOwnedReliefComposition(document, result.field)).toBe(true);
      expect(isOwnedReliefComposition({ ...document }, result.field)).toBe(false);
      expect(isOwnedReliefComposition(document, { ...result.field })).toBe(false);
    }
  });
  it('does not create a worker for an already aborted signal', async () => {
    const { document, owner } = fixture();
    const createWorker = vi.fn(owner.createWorker);
    const controller = new AbortController();
    controller.abort();
    expect(
      await composeReliefInWorker(document, controller.signal, undefined, { createWorker }),
    ).toEqual({ kind: 'cancelled' });
    expect(createWorker).not.toHaveBeenCalled();
  });
});
