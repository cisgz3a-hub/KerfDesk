import type { UnsafePriorState } from '../../../app/unsafePriorState';

export interface UnsafePriorStateAlert {
  readonly title: string;
  readonly body: string;
}

export type UnsafePriorStateStartedAtFormatter = (startedAt: number) => string;

/**
 * T2-6 Phase 3av: pure recovery-message formatting for the unsafe-prior-state
 * startup dialog. App.tsx still owns storage reads, modal display, and clearing
 * the persisted flag after acknowledgement.
 */
export function formatUnsafePriorStateStartedAt(startedAt: number): string {
  try {
    return new Date(startedAt).toLocaleString();
  } catch {
    return new Date(startedAt).toString();
  }
}

export function buildUnsafePriorStateAlert(
  unsafe: UnsafePriorState,
  formatStartedAt: UnsafePriorStateStartedAtFormatter = formatUnsafePriorStateStartedAt,
): UnsafePriorStateAlert {
  const startedLabel = formatStartedAt(unsafe.startedAt);
  return {
    title: 'Previous session ended unexpectedly',
    body:
      'A job was running when the previous session ended. The machine ' +
      'state may be unsafe — laser, head position, and workpiece may ' +
      'all have unexpected values. Inspect the machine and the ' +
      'workpiece BEFORE reconnecting.\n\n' +
      `Job started: ${startedLabel}` +
      (unsafe.ticketId ? `\nTicket: ${unsafe.ticketId}` : ''),
  };
}
