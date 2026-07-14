// Autofocus protocol orchestration (F-B / WORKFLOW.md autofocus stub).
//
// Per-machine autofocus is vendor-specific — the Creality Falcon A1 Pro
// implements `$HZ1` as a single-line GrblHAL macro that runs the internal
// probe; other machines use G38.2-style probe sequences or proprietary
// M-codes (some don't support it at all). This module owns the wire
// protocol regardless of which command body the user pasted:
//   1. Pre-flight: connection open, controller idle, single-line command.
//   2. Send the command through the shared write/ack ledger.
//   3. Let the store's one line pump own `ok` / `error:` / status reports.
//   4. Resolve after both the terminal ok and either a later Idle report or
//      an active -> Idle cycle (Falcon firmwares do not all expose activity).
//   5. Reject on `error:`, on `<Alarm|...>`, or on 15s timeout.
//
// The 15s default mirrors the firmware behavior observed on Falcon A1
// Pro — the probe cycle takes ~5-8s, anything longer is a hang and
// continuing would risk crashing the head into the workpiece.

import { classifyResponse, type StatusReport } from '../../core/controllers/grbl';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { TranscriptSource } from './laser-transcript';

export const AUTOFOCUS_TIMEOUT_MS = 15_000;

export type AutofocusResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'rejected'; readonly errorCode: number | null; readonly raw: string }
  | { readonly kind: 'alarm'; readonly alarmCode: number | null }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'preflight-failed'; readonly reason: string };

export type RunAutofocusArgs = {
  readonly connected: boolean;
  readonly statusReport: StatusReport | null;
  readonly command: string;
  readonly refs: ControllerLifecycleRefs;
  readonly write: (
    line: string,
    action?: LaserSafetyAction,
    source?: TranscriptSource,
  ) => Promise<void>;
  readonly timeoutMs?: number;
};

export async function runAutofocus(args: RunAutofocusArgs): Promise<AutofocusResult> {
  const preflight = checkPreflight(args);
  if (preflight !== null) return preflight;
  const command = args.command.trim();
  const timeoutMs = args.timeoutMs ?? AUTOFOCUS_TIMEOUT_MS;
  try {
    await startControllerCommand(args.refs, args.write, {
      kind: 'autofocus',
      label: 'Auto-focus',
      command: `${command}\n`,
      source: 'motion',
      timeoutMs,
      completion: 'terminal-and-idle',
    });
    return { kind: 'ok' };
  } catch (err) {
    return autofocusFailureResult(err);
  }
}

function checkPreflight(args: RunAutofocusArgs): AutofocusResult | null {
  if (!args.connected) {
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

function autofocusFailureResult(err: unknown): AutofocusResult {
  const message = err instanceof Error ? err.message : String(err);
  const response = classifyResponse(message);
  if (response.kind === 'error') {
    return {
      kind: 'rejected',
      errorCode: response.code,
      raw: response.raw ?? (response.code === null ? message : `error:${response.code}`),
    };
  }
  if (response.kind === 'alarm') return { kind: 'alarm', alarmCode: response.code };
  if (/\balarm\b/i.test(message)) return { kind: 'alarm', alarmCode: null };
  if (/timed out/i.test(message)) return { kind: 'timeout' };
  return { kind: 'preflight-failed', reason: message };
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
        message: `Auto-focus timed out after ${Math.round(AUTOFOCUS_TIMEOUT_MS / 1000)}s. The machine may still be moving; use the physical stop or power cutoff now if unsafe.`,
        variant: 'warning',
      };
    case 'preflight-failed':
      return { message: `Auto-focus: ${result.reason}`, variant: 'warning' };
  }
}
