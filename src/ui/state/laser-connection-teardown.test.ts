import { describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import {
  closeConnectionOnce,
  runIntentionalDisconnectOnce,
  type ConnectionTeardownOwnershipRefs,
} from './laser-connection-teardown';

function ownershipRefs(): ConnectionTeardownOwnershipRefs {
  return {
    closeRequests: new WeakMap(),
    intentionalDisconnects: new WeakMap(),
  };
}

function connection(): SerialConnection & {
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly forget: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    write: vi.fn(async () => undefined),
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
  };
}

describe('connection teardown ownership', () => {
  it('revokes permission exactly once when Forget arrives after close settled', async () => {
    const refs = ownershipRefs();
    const port = connection();

    await closeConnectionOnce(refs, port);
    await closeConnectionOnce(refs, port, true);
    await closeConnectionOnce(refs, port, true);

    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.forget).toHaveBeenCalledTimes(1);
  });

  it('joins a post-settlement Forget to one owner and runs its finalizer', async () => {
    const refs = ownershipRefs();
    const port = connection();
    const owner = vi.fn(async () => closeConnectionOnce(refs, port));
    const finalizeForget = vi.fn(async () => undefined);

    await runIntentionalDisconnectOnce(refs, port, false, owner);
    await runIntentionalDisconnectOnce(refs, port, true, owner, finalizeForget);

    expect(owner).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.forget).toHaveBeenCalledTimes(1);
    expect(finalizeForget).toHaveBeenCalledTimes(1);
  });
});
