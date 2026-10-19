import { afterEach, expect, it, vi } from 'vitest';
import type { TextWorkerMessage, TextWorkerRequest } from './text-render-worker-protocol';

const runtime = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock('./text-render-worker-runtime', () => ({ createTextWorkerRuntime: () => runtime }));
afterEach(() => vi.unstubAllGlobals());

it('returns a fatal reply with the request identity when transferring the result throws', async () => {
  const replies: TextWorkerMessage[] = [];
  const scope = {
    onmessage: null as ((event: MessageEvent<TextWorkerRequest>) => void) | null,
    postMessage: (message: TextWorkerMessage) => {
      if (message.kind === 'missing') throw new DOMException('transfer refused', 'DataCloneError');
      replies.push(message);
    },
  };
  runtime.respond.mockResolvedValue({
    response: { id: 7, kind: 'missing', characters: [] },
    transfer: [],
  });
  vi.stubGlobal('self', scope);
  await import('./text-render-worker');
  scope.onmessage?.({
    data: { id: 7, task: { kind: 'missing-characters', content: 'A', fontToken: 1 } },
  } as MessageEvent<TextWorkerRequest>);
  await vi.waitFor(() =>
    expect(replies).toContainEqual({
      id: 7,
      kind: 'fatal',
      message: expect.stringContaining('transfer refused'),
    }),
  );
});
