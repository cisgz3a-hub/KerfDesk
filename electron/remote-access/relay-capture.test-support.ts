// The stand-in relay client the runtime suites install with `vi.mock`. It holds no
// import of the runtime, so a suite can load it inside `vi.hoisted` before its mocks.
import { vi } from 'vitest';
import type { RemoteIdentity } from './credential-store.js';
import type { RemoteRendererQueue } from './renderer-queue.js';
import type { RemoteScope } from './relay-types.js';

export type RelayOptions = {
  queue: RemoteRendererQueue;
  canRequest: (clientId: string, scopes: RemoteScope[]) => boolean;
  onConnection: (open: boolean) => void;
  onMessage: (message: Record<string, unknown>) => void;
};
export const captured = {
  options: null as RelayOptions | null,
  relay: {
    send: vi.fn((_message: Record<string, unknown>) => true),
    start: vi.fn((_identity: RemoteIdentity) => undefined),
    close: vi.fn(),
    cancelRequests: vi.fn(),
    cancelClient: vi.fn((_clientId: string) => undefined),
    requestId: () => crypto.randomUUID(),
  },
};

/** Clears every mock and the captured options; run it before each test. */
export function resetCaptured(): void {
  vi.clearAllMocks();
  captured.options = null;
  captured.relay.close.mockImplementation(() => captured.options?.onConnection(false));
}
