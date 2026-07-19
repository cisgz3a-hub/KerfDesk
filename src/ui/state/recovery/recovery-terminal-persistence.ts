import type { RunId } from './execution-artifact';
import type { PersistedRecoverySlots } from './recovery-model';
import { completeRunMutation, interruptRunMutation } from './recovery-slot-mutations';
import type { PendingRecoveryTerminal } from './recovery-terminal-coordinator';

export type RecoveryTerminalPersistencePlan = {
  readonly operation: string;
  readonly mutate: (slots: PersistedRecoverySlots) => {
    readonly slots: PersistedRecoverySlots;
    readonly value: boolean;
  };
};

export function recoveryTerminalPersistencePlan(
  runId: RunId,
  terminal: PendingRecoveryTerminal,
): RecoveryTerminalPersistencePlan {
  return terminal.kind === 'completed'
    ? {
        operation: 'complete job recovery tracking',
        mutate: (slots) => completeRunMutation(slots, runId, terminal.completedAtIso),
      }
    : {
        operation: 'save interrupted job recovery',
        mutate: (slots) =>
          interruptRunMutation(
            slots,
            runId,
            terminal.ackedLines,
            terminal.interruption,
            terminal.updatedAtIso,
          ),
      };
}
