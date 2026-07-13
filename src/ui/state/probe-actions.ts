// Probe result classification and operator wording (ADR-103 G2). Physical
// command ownership lives in laser-probe-actions.ts so probing shares the one
// controller transaction arbiter with Home, post-job settle, and recovery.

const ALARM_PROBE_TRIGGERED = 4;
const ALARM_PROBE_NO_CONTACT = 5;

export const PROBE_LINE_TIMEOUT_MS = 45_000;

export type ProbeResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'probe-failed'; readonly alarmCode: number }
  | { readonly kind: 'alarm'; readonly alarmCode: number | null }
  | { readonly kind: 'rejected'; readonly errorCode: number | null; readonly raw: string }
  | { readonly kind: 'timeout'; readonly pendingLine: string }
  | { readonly kind: 'preflight-failed'; readonly reason: string };

export function probeResultFromControllerFailure(
  error: unknown,
  pendingLine: string,
): Exclude<ProbeResult, { readonly kind: 'ok' }> {
  const message = error instanceof Error ? error.message : String(error);
  const alarmMatch = /ALARM:(\d+)/i.exec(message);
  if (alarmMatch?.[1] !== undefined) {
    const alarmCode = Number.parseInt(alarmMatch[1], 10);
    return alarmCode === ALARM_PROBE_TRIGGERED || alarmCode === ALARM_PROBE_NO_CONTACT
      ? { kind: 'probe-failed', alarmCode }
      : { kind: 'alarm', alarmCode };
  }
  if (/controller entered Alarm/i.test(message)) {
    return { kind: 'alarm', alarmCode: null };
  }
  const errorMatch = /(?:^|\s)(error)(?::(\d+))?/i.exec(message);
  if (errorMatch !== null) {
    return {
      kind: 'rejected',
      errorCode: errorMatch[2] === undefined ? null : Number.parseInt(errorMatch[2], 10),
      raw: message,
    };
  }
  if (/timed out/i.test(message)) return { kind: 'timeout', pendingLine };
  return { kind: 'preflight-failed', reason: message };
}

// Toast wording lives with the result so every caller says the same thing.
export function describeProbeResult(result: ProbeResult): {
  readonly message: string;
  readonly variant: 'success' | 'warning' | 'error';
} {
  switch (result.kind) {
    case 'ok':
      return {
        message: 'Probe complete — work zero is set and motion is settled.',
        variant: 'success',
      };
    case 'probe-failed':
      return {
        message:
          result.alarmCode === ALARM_PROBE_NO_CONTACT
            ? 'Probe never touched the plate within the travel limit (ALARM:5). Check the clip lead and start closer, then $X to unlock and retry.'
            : 'Probe reported contact before it moved (ALARM:4). Check for a short / already-touching bit, then $X to unlock and retry.',
        variant: 'error',
      };
    case 'alarm':
      return {
        message: `Probe alarm${result.alarmCode === null ? '' : ` ${result.alarmCode}`}. Send $X to unlock before retrying.`,
        variant: 'error',
      };
    case 'rejected':
      return { message: `Probe command rejected: ${result.raw}`, variant: 'error' };
    case 'timeout':
      return {
        message: `Probe timed out waiting on "${result.pendingLine}". Motion state is unknown — use the physical stop if unsafe and wait for a fresh Idle report before retrying.`,
        variant: 'warning',
      };
    case 'preflight-failed':
      return { message: `Probe: ${result.reason}`, variant: 'warning' };
  }
}
