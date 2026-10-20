import { afterEach, expect, it, vi } from 'vitest';
import type { VectorOpMessage, VectorOpRequest } from './vector-op-worker-protocol';

afterEach(() => vi.unstubAllGlobals());

it('announces that its script has run before it answers anything', async () => {
  const posted: VectorOpMessage[] = [];
  const scope = {
    onmessage: null as ((event: MessageEvent<VectorOpRequest>) => void) | null,
    postMessage: (message: VectorOpMessage) => posted.push(message),
  };
  vi.stubGlobal('self', scope);
  await import('./vector-op-worker');
  expect(posted).toStrictEqual([{ kind: 'ready' }]);
  expect(scope.onmessage).toBeTypeOf('function');
});
