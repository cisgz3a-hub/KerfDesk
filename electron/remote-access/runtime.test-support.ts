// Fixtures shared by the remote-access runtime suites.
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { RemoteCredentialStore, RemoteIdentity } from './credential-store.js';
import { captured } from './relay-capture.test-support.js';
import type { RemoteScope } from './relay-types.js';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { createRemoteAccessRuntime } from './runtime.js';

export function identity(): RemoteIdentity {
  return {
    schemaVersion: 1,
    deviceId: randomUUID(),
    ownerSecret: 'A'.repeat(43),
    enabled: true,
    revokeOnConnect: false,
    pendingRevocations: [],
  };
}
export function fixture(initial: RemoteIdentity | null = identity(), monotonicNow?: () => number) {
  let saved = initial;
  const store: RemoteCredentialStore = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value) => {
      saved = structuredClone(value);
    }),
    discard: vi.fn(async () => {
      saved = null;
      return true;
    }),
    create: () => ({ ...identity(), enabled: false }),
  };
  const queue = createRemoteRendererQueue();
  queue.attach();
  const runtime = createRemoteAccessRuntime(store, queue, monotonicNow);
  return { runtime, store, saved: () => saved, queue, options: captured.options! };
}
export type Fixture = ReturnType<typeof fixture>;
export const client = (scopes: RemoteScope[] = ['read', 'edit']) => ({
  id: randomUUID(),
  label: 'Approved client',
  scopes,
  createdAt: Date.now(),
});
export async function connected(f: ReturnType<typeof fixture>, clients = [client()]) {
  await f.runtime.opened();
  f.options.onConnection(true);
  f.options.onMessage({ type: 'clients', clients });
  return clients;
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export const flush = () => new Promise<void>((done) => setImmediate(done));

export function pairingMessage(f: ReturnType<typeof fixture>, duration = 300_000) {
  f.runtime.pair();
  const requestId = captured.relay.send.mock.calls.findLast(
    ([value]) => value.type === 'pair.create',
  )![0].requestId;
  return {
    type: 'pair.offer',
    requestId,
    code: 'NewCode12345A',
    expiresAt: 1_700_000_300_000,
    expiresInMs: duration,
  };
}
