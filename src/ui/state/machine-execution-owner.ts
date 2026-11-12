import type { LaserMotionOperationId } from './laser-motion-operation';

/** Optional caller ownership, checked at the ordinary action's wire boundary. */
export type MachineExecutionOwner = {
  readonly signal?: AbortSignal;
  readonly assertCurrent?: () => void;
  readonly onMotionOwner?: (id: LaserMotionOperationId) => void;
  /** A command may have reached the controller once this boundary is crossed. */
  readonly onDispatch?: () => void;
  /** The warn-only jog bounds and no-go texts the PC just showed for this jog (ADR-232),
   * so a remote receipt can repeat them word for word (ADR-585 Amendment 3). */
  readonly onMotionWarnings?: (warnings: readonly string[]) => void;
};

export function assertMachineExecutionOwner(owner?: MachineExecutionOwner): void {
  owner?.signal?.throwIfAborted();
  owner?.assertCurrent?.();
}

export function ownedMachineWrite<T extends unknown[], R>(
  write: (...args: T) => R,
  owner?: MachineExecutionOwner,
): (...args: T) => R {
  if (owner === undefined) return write;
  return (...args) => {
    assertMachineExecutionOwner(owner);
    // Live SafeWrite carries this fourth argument through to conn.write.
    // Nested canonical motion and caller guards must both survive that seam.
    const previous = args[3];
    const guarded: unknown[] = [...args];
    guarded[3] = () => {
      if (typeof previous === 'function') previous();
      assertMachineExecutionOwner(owner);
    };
    return (write as (...values: unknown[]) => R)(...guarded);
  };
}
