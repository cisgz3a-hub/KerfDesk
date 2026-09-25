// ControllerEvent — the firmware-neutral classification of one inbound serial
// line. A superset of GRBL's response vocabulary: GRBL never produces 'busy'
// or 'resend', Marlin never produces 'setting' or 'alarm', but the store-side
// line pipeline routes on THIS union so no ui/state file needs to know which
// firmware is talking (ADR-094).

import type { StatusReport } from './grbl/status-parser';

export type ControllerEvent =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'error';
      readonly code: number | null;
      readonly raw?: string;
      // The firmware stopped itself and answers nothing until it is reset or
      // power-cycled (Marlin `Error:Printer halted. kill() called!`).
      readonly halted?: true;
    }
  | { readonly kind: 'alarm'; readonly code: number }
  | { readonly kind: 'status'; readonly report: StatusReport }
  | { readonly kind: 'setting'; readonly id: number; readonly value: string }
  | { readonly kind: 'message'; readonly tag: string; readonly body: string }
  | { readonly kind: 'welcome'; readonly raw: string }
  // Marlin `echo:busy: processing` — the controller is alive but not ready
  // for the next line; senders must not treat it as an ack.
  | { readonly kind: 'busy' }
  // Marlin checksum-mode `Resend: N`. v1 senders surface this as a stream
  // error; line-number retransmission is out of scope until demanded.
  | { readonly kind: 'resend'; readonly line: number }
  // Marlin `echo:Unknown command: "<command>"`: the firmware skipped a line it
  // has no handler for, then acknowledges that line with an ordinary `ok`
  // (gcode.cpp unknown_command_warning, then ok_to_send). Marlin runs lines in
  // order, so the echo belongs to the oldest line still owed an answer.
  // `requirement` names the build option that provides the command, when the
  // driver knows it.
  | {
      readonly kind: 'unknown-command';
      readonly command: string;
      readonly raw: string;
      readonly requirement: string | null;
    }
  | { readonly kind: 'unknown'; readonly raw: string };

/** True when the command a firmware echoed back is the command of `sentLine`:
 * both compared without comments, surrounding space or case. */
export function echoedCommandMatchesLine(echoed: string, sentLine: string): boolean {
  return normalizedCommand(echoed) === normalizedCommand(sentLine);
}

function normalizedCommand(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/;.*$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}
