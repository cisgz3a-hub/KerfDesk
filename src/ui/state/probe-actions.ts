// Probe protocol runner (ADR-103 G2) — sibling to autofocus-action.ts.
//
// Sends a probing sequence one line at a time, waiting for GRBL's `ok`
// before the next line (G38.2 blocks until contact or failure, so its `ok`
// marks cycle completion). Failure surface:
//   error:N   → line rejected (sequence stops; machine idle)
//   ALARM:4/5 → probe cycle failed (already-triggered / no contact) — GRBL
//               locks up; the operator must $X before retrying
//   status <Alarm|…> → same lock, seen via the poll instead of the line
//   timeout   → no ok within the per-line watchdog; machine may still move
//
// The per-line watchdog resets on every ok, so a long multi-leg corner
// cycle never needs one giant timeout budget.

import { classifyResponse } from '../../core/controllers/grbl';
import type { StatusReport } from '../../core/controllers/grbl';
import type { SerialConnection } from '../../platform/types';

export const PROBE_LINE_TIMEOUT_MS = 45_000;

const ALARM_PROBE_TRIGGERED = 4;
const ALARM_PROBE_NO_CONTACT = 5;

export type ProbeResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'probe-failed'; readonly alarmCode: number }
  | { readonly kind: 'alarm'; readonly alarmCode: number | null }
  | { readonly kind: 'rejected'; readonly errorCode: number | null; readonly raw: string }
  | { readonly kind: 'timeout'; readonly pendingLine: string }
  | { readonly kind: 'preflight-failed'; readonly reason: string };

export type RunProbeArgs = {
  readonly connection: SerialConnection | null;
  readonly statusReport: StatusReport | null;
  readonly lines: ReadonlyArray<string>;
  readonly lineTimeoutMs?: number;
};

export async function runProbeSequence(args: RunProbeArgs): Promise<ProbeResult> {
  const preflight = checkPreflight(args);
  if (preflight !== null) return preflight;
  // Non-null after preflight; narrowed for the closure below.
  const conn = args.connection as SerialConnection;
  const timeoutMs = args.lineTimeoutMs ?? PROBE_LINE_TIMEOUT_MS;

  return await new Promise<ProbeResult>((resolve) => {
    let nextIndex = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe?.();
      resolve(result);
    };

    const pendingLine = (): string => args.lines[Math.min(nextIndex, args.lines.length - 1)] ?? '';

    const armTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => finish({ kind: 'timeout', pendingLine: pendingLine() }), timeoutMs);
    };

    const sendNext = (): void => {
      const line = args.lines[nextIndex];
      if (line === undefined) {
        finish({ kind: 'ok' });
        return;
      }
      nextIndex += 1;
      armTimer();
      void conn.write(`${line}\n`).catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        finish({ kind: 'preflight-failed', reason: `Write failed: ${reason}` });
      });
    };

    unsubscribe = conn.onLine((line) => {
      const cls = classifyResponse(line);
      if (cls.kind === 'ok') {
        sendNext();
        return;
      }
      if (cls.kind === 'error') {
        finish({ kind: 'rejected', errorCode: cls.code, raw: line });
        return;
      }
      if (cls.kind === 'alarm') {
        finish(
          cls.code === ALARM_PROBE_TRIGGERED || cls.code === ALARM_PROBE_NO_CONTACT
            ? { kind: 'probe-failed', alarmCode: cls.code }
            : { kind: 'alarm', alarmCode: cls.code },
        );
        return;
      }
      if (cls.kind === 'status' && cls.report.state.toLowerCase() === 'alarm') {
        finish({ kind: 'alarm', alarmCode: null });
      }
    });

    sendNext();
  });
}

function checkPreflight(args: RunProbeArgs): ProbeResult | null {
  if (args.connection === null) {
    return { kind: 'preflight-failed', reason: 'Not connected to a controller' };
  }
  if (args.lines.length === 0) {
    return { kind: 'preflight-failed', reason: 'Probe sequence is empty' };
  }
  if (args.statusReport !== null && args.statusReport.state.toLowerCase() !== 'idle') {
    return {
      kind: 'preflight-failed',
      reason: `Machine must be Idle to probe (currently ${args.statusReport.state})`,
    };
  }
  return null;
}

// Toast wording lives with the protocol so every caller says the same thing.
export function describeProbeResult(result: ProbeResult): {
  readonly message: string;
  readonly variant: 'success' | 'warning' | 'error';
} {
  switch (result.kind) {
    case 'ok':
      return { message: 'Probe complete — work zero is set.', variant: 'success' };
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
        message: `Probe timed out waiting on "${result.pendingLine}". The machine may still be moving — use the physical stop if unsafe.`,
        variant: 'warning',
      };
    case 'preflight-failed':
      return { message: `Probe: ${result.reason}`, variant: 'warning' };
  }
}
