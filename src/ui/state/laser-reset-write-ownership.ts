import type { ResetOwnership, ResetWriteFn } from './laser-reset-ownership';

// An ordinary off write still pending across a boot can deliver a late reply.
// Track it independently of the public ledger, which the boot legitimately
// resets. A new reset owner on the same physical port inherits this ambiguity.
const cleanupWrites = new WeakMap<object, number>();

function connectionKey(owner: ResetOwnership): object {
  return typeof owner.connection === 'object' && owner.connection !== null
    ? owner.connection
    : owner.refs;
}

export function resetCleanupWritesPending(owner: ResetOwnership): boolean {
  return (cleanupWrites.get(connectionKey(owner)) ?? 0) > 0;
}

export function trackedResetCleanupWriter(owner: ResetOwnership): ResetWriteFn {
  return (line, action, source) => {
    const key = connectionKey(owner);
    cleanupWrites.set(key, (cleanupWrites.get(key) ?? 0) + 1);
    const finished = (): void => {
      cleanupWrites.set(key, Math.max(0, (cleanupWrites.get(key) ?? 0) - 1));
    };
    try {
      const write = owner.cleanupWrite(line, action, source);
      void write.then(finished, finished);
      return write;
    } catch (error) {
      finished();
      throw error;
    }
  };
}
