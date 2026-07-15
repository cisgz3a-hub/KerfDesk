// ControllerDriver — everything the connection/store layer needs to talk to
// one firmware family, as pure data + pure functions (ADR-094). Drivers build
// strings and classify lines; they never touch the serial port, the clock, or
// React. `null` command/realtime entries mean "this firmware has no such
// operation" — callers gate on capabilities before reaching for them.

import type { ControllerKind } from '../devices/device-profile';
import type { ControllerCapabilities } from './controller-capabilities';
import type { ControllerEvent } from './controller-event';
import type { JogParams } from './grbl/commands';
import type { ConsoleCommandResult } from './grbl/console-command';

export type FrameBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type ControllerRealtime = {
  /** Status report request byte (GRBL '?'), written outside the line queue. */
  readonly statusQuery: string | null;
  /** Feed hold (GRBL '!'). */
  readonly hold: string | null;
  /** Safety Door (GRBL 0x84): controlled motion stop plus accessory shutdown. */
  readonly safetyDoor: string | null;
  /** Cycle start / resume (GRBL '~'). */
  readonly resume: string | null;
  /** Abort / soft reset (GRBL \x18). */
  readonly softReset: string | null;
  /** Cancel the in-flight jog only (GRBL \x85). */
  readonly jogCancel: string | null;
};

export type ControllerCommands = {
  readonly home: string | null;
  readonly unlock: string | null;
  readonly sleep: string | null;
  readonly settingsQuery: string | null;
  /** Owned active-modal query used with offsetsQuery for Work-Z recovery. */
  readonly modalStateQuery: string | null;
  /** Owned WCS-offset query used with modalStateQuery for Work-Z recovery. */
  readonly offsetsQuery: string | null;
  /** Queued (non-realtime) position/status query, polled ONLY while nothing
   *  is streaming or awaiting acks (Marlin 'M114'). null when the firmware
   *  has a realtime report instead. */
  readonly queuedStatusQuery: string | null;
  /** Best-effort de-energize lines written after a job Abort
   *  (GRBL: ['M9']; Marlin: ['M5', 'M107']). No trailing newlines. */
  readonly stopLaserLines: ReadonlyArray<string>;
  /** Ack-fenced no-op used as a settle marker after motion (GRBL 'G4 P0.01';
   *  Marlin 'M400' which acks only when buffered motion has drained). */
  readonly settleDwell: string;
  readonly setOriginHere: string | null;
  readonly clearOrigin: string | null;
  readonly setPersistentOriginHere: string | null;
  readonly clearPersistentOrigin: string | null;
  /** Build the jog payload (no trailing newline). May be MULTI-LINE on
   *  firmwares without a native jog protocol (Marlin/Smoothie emit
   *  G91\nG0…\nG90) — every line is acked individually, and the write
   *  layer counts one owed ack per newline (audit F3). */
  readonly buildJog: (params: JogParams) => string;
  /** Build the framing move sequence, each line newline-terminated. */
  readonly buildFrameLines: (bounds: FrameBounds, feed: number) => ReadonlyArray<string>;
  /** Safe-Z retract jogged before a CNC frame trace. Optional: a driver whose
   *  firmware has no jog-based Z retract omits it, and the caller skips the
   *  retract prefix. Newline-terminated to match buildFrameLines. */
  readonly buildFrameRetract?: (zMm: number, feed: number) => string;
};

export type ConsoleQuickCommand = {
  readonly label: string;
  readonly command: string;
  readonly hint: string;
};

export type ControllerDriver = {
  readonly kind: ControllerKind;
  readonly label: string;
  readonly defaultBaudRate: number;
  readonly capabilities: ControllerCapabilities;
  readonly realtime: ControllerRealtime;
  readonly commands: ControllerCommands;
  /** Classify one inbound line into the firmware-neutral event union. */
  readonly classifyLine: (line: string) => ControllerEvent;
  /** Validate + normalize one console input line for this firmware. */
  readonly prepareConsoleCommand: (input: string) => ConsoleCommandResult;
  readonly consoleQuickCommands: ReadonlyArray<ConsoleQuickCommand>;
  /** True when a write payload contains setup-only lines that must be blocked
   *  while a job is active (GRBL: any `$` line). */
  readonly isSetupOnlyPayload: (payload: string) => boolean;
};
