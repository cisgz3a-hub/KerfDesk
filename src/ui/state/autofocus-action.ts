// Autofocus protocol orchestration (F-B / WORKFLOW.md autofocus stub).
//
// Per-machine autofocus is vendor-specific — the Creality Falcon A1 Pro
// implements `$HZ1` as a single-line GrblHAL macro that runs the internal
// probe; other machines use G38.2-style probe sequences or proprietary
// M-codes (some don't support it at all). This module owns the wire
// protocol regardless of which command body the user pasted:
//   1. Pre-flight: connection open, controller idle, single-line command.
//   2. Send the command. Request status immediately so we see the
//      transition without waiting for the next 250ms poll cycle.
//   3. Watch incoming lines for `ok` / `error:` / status reports.
//   4. Resolve when the controller transitions through any non-idle
//      status and back to Idle (or ack + Idle, since some Falcon
//      firmwares never expose an active state during $HZ1).
//   5. Reject on `error:`, on `<Alarm|...>`, or on 15s timeout.
//
// The 15s default mirrors the firmware behavior observed on Falcon A1
// Pro — the probe cycle takes ~5-8s, anything longer is a hang and
// continuing would risk crashing the head into the workpiece.

import { classifyResponse, RT_STATUS, type StatusReport } from '../../core/controllers/grbl';
import type { SerialConnection } from '../../platform/types';

export const AUTOFOCUS_TIMEOUT_MS = 15_000;

export type AutofocusResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'rejected'; readonly errorCode: number; readonly raw: string }
  | { readonly kind: 'alarm'; readonly alarmCode: number | null }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'preflight-failed'; readonly reason: string };

export type RunAutofocusArgs = {
  readonly connection: SerialConnection | null;
  readonly statusReport: StatusReport | null;
  readonly command: string;
  readonly timeoutMs?: number;
};

export async function runAutofocus(args: RunAutofocusArgs): Promise<AutofocusResult> {
  const preflight = checkPreflight(args);
  if (preflight !== null) return preflight;
  // Non-null after preflight; narrowed for the closure below.
  const conn = args.connection as SerialConnection;
  const command = args.command.trim();
  const timeoutMs = args.timeoutMs ?? AUTOFOCUS_TIMEOUT_MS;

  return await new Promise<AutofocusResult>((resolve) => {
    // Phase tracking: we resolve only after seeing the controller leave
    // Idle and come back, OR (Falcon edge case) after the command is
    // ack'd AND we see Idle in a later status report. The two flags
    // discriminate "first Idle is stale pre-command" vs "Idle after ack".
    let commandAcknowledged = false;
    let sawActiveState = false;
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (result: AutofocusResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(result);
    };

    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);

    unsubscribe = conn.onLine((line) => {
      const cls = classifyResponse(line);
      if (cls.kind === 'ok' && !commandAcknowledged) {
        commandAcknowledged = true;
        // Nudge for an immediate status so we don't wait the full 250ms
        // for the next poll to learn the controller state.
        void conn.write(RT_STATUS).catch(() => undefined);
        return;
      }
      if (cls.kind === 'error') {
        finish({ kind: 'rejected', errorCode: cls.code, raw: line });
        return;
      }
      if (cls.kind === 'alarm') {
        finish({ kind: 'alarm', alarmCode: cls.code });
        return;
      }
      if (cls.kind !== 'status') return;
      const state = cls.report.state.toLowerCase();
      if (state === 'alarm') {
        finish({ kind: 'alarm', alarmCode: null });
        return;
      }
      // Any non-idle/non-alarm state token (Home / Run / Focus /
      // non-standard Falcon tokens) signals the probe cycle is active.
      if (state !== 'idle') {
        sawActiveState = true;
        return;
      }
      // Idle. Only treat it as success once we've either seen an active
      // phase OR the command was acknowledged — otherwise we'd resolve
      // on the pre-command Idle that arrived between us subscribing and
      // the controller noticing the new command.
      if (sawActiveState || commandAcknowledged) {
        finish({ kind: 'ok' });
      }
    });

    // Send the command and immediately request a status so the first
    // post-command poll arrives within ~one round-trip rather than up
    // to STATUS_POLL_MS later.
    void conn
      .write(`${command}\n`)
      .then(() => conn.write(RT_STATUS))
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        finish({ kind: 'preflight-failed', reason: `Write failed: ${reason}` });
      });
  });
}

function checkPreflight(args: RunAutofocusArgs): AutofocusResult | null {
  if (args.connection === null) {
    return { kind: 'preflight-failed', reason: 'Not connected to a controller' };
  }
  const command = args.command.trim();
  if (command === '') {
    return { kind: 'preflight-failed', reason: 'Autofocus command is empty' };
  }
  if (/[\r\n]/.test(command)) {
    return {
      kind: 'preflight-failed',
      reason: 'Autofocus command must be a single line',
    };
  }
  if (args.statusReport !== null && args.statusReport.state.toLowerCase() !== 'idle') {
    return {
      kind: 'preflight-failed',
      reason: `Machine must be Idle to auto-focus (currently ${args.statusReport.state})`,
    };
  }
  return null;
}

// Map an AutofocusResult to a user-friendly toast message + variant.
// Lives next to the protocol so callers don't have to keep the wording
// in sync — every consumer pushes the same strings.
export function describeAutofocusResult(result: AutofocusResult): {
  readonly message: string;
  readonly variant: 'success' | 'warning' | 'error';
} {
  switch (result.kind) {
    case 'ok':
      return { message: 'Auto-focus complete', variant: 'success' };
    case 'rejected':
      if (result.errorCode === 20) {
        return {
          message: `Auto-focus rejected (error:20 — unsupported on this firmware). Update GrblHAL or check the command for your machine.`,
          variant: 'error',
        };
      }
      if (result.errorCode === 9) {
        return {
          message: `Auto-focus rejected (error:9 — G-code locked / no probe pin).`,
          variant: 'error',
        };
      }
      return {
        message: `Auto-focus rejected: ${result.raw}`,
        variant: 'error',
      };
    case 'alarm':
      return {
        message: `Auto-focus alarm${result.alarmCode === null ? '' : ` ${result.alarmCode}`}. Send $X to unlock before retrying.`,
        variant: 'error',
      };
    case 'timeout':
      return {
        message: `Auto-focus timed out after ${Math.round(AUTOFOCUS_TIMEOUT_MS / 1000)}s. Check the log for the last response.`,
        variant: 'warning',
      };
    case 'preflight-failed':
      return { message: `Auto-focus: ${result.reason}`, variant: 'warning' };
  }
}
