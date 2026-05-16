import type { UnsafePriorState } from '../../../app/unsafePriorState';
import type { AutosavePayload } from '../../../app/autosavePersistence';
import { evaluateRecoveryEligibility } from '../../../app/recoveryEligibility';

export interface UnsafePriorStateAlert {
  readonly title: string;
  readonly body: string;
}

export interface AutosaveRecoveryStartupPrompt {
  readonly shouldShow: boolean;
  readonly timeLabel: string | null;
}

export type UnsafePriorStateStartedAtFormatter = (startedAt: number) => string;
export type AutosaveTimestampFormatter = (timestamp: string) => string | null;

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

/**
 * T2-6 Phase 3aw: startup autosave-recovery prompt decisions live here so
 * App.tsx only owns the read side effect and dialog-store writes.
 */
export function formatAutosaveRecoveryTimestamp(timestamp: string): string | null {
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
  } catch {
    return null;
  }
}

export function buildAutosaveRecoveryStartupPrompt(
  payload: AutosavePayload | null,
  formatTimestamp: AutosaveTimestampFormatter = formatAutosaveRecoveryTimestamp,
): AutosaveRecoveryStartupPrompt {
  if (payload == null) {
    return { shouldShow: false, timeLabel: null };
  }
  const eligibility = evaluateRecoveryEligibility(payload.json);
  if (!eligibility.shouldOffer) {
    return { shouldShow: false, timeLabel: null };
  }
  return {
    shouldShow: true,
    timeLabel: formatTimestamp(payload.timestamp),
  };
}
