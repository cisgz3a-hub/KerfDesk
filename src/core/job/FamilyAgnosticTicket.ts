/**
 * T2-29: controller-family-agnostic ticket schema. Pre-T2-29 the
 * ticket at `src/core/job/ValidatedJobTicket.ts:21-25` hardcoded
 * G-code-only fields (`gcodeLines: readonly string[]`,
 * `gcodeText: string`) and controller type literally `'grbl'`. For
 * any binary-output controller (Falcon WiFi job-upload, Marlin
 * binary streams) the ticket cannot represent the job.
 *
 * The validation at `MachineService.ts:349-355`
 * (`currentControllerType !== ticket.controllerType`) was theatre —
 * `currentControllerType` is the literal `'grbl'`, so the check
 * never failed in practice but appeared to validate something.
 *
 * T2-29 ships the family-agnostic shape + capability-match validator
 * + adapter helpers. Migrating `ValidatedJobTicket` consumers
 * (PipelineService, MachineService, JobLog, autosave) is filed as
 * T2-29-followup since it ripples through serialisation, hashing,
 * persistence.
 */

export type ControllerFamily =
  | 'grbl'
  | 'marlin'
  | 'smoothie'
  | 'falcon-wifi'
  | 'unknown';

export type OutputFormat =
  | 'gcode-lines'
  | 'gcode-text'
  | 'binary-stream'
  | 'job-upload';

export type ControllerOutput =
  | { kind: 'gcode-lines'; lines: readonly string[] }
  | { kind: 'gcode-text'; text: string }
  | { kind: 'binary-stream'; bytes: Uint8Array }
  | { kind: 'job-upload'; filename: string; payload: Uint8Array };

export interface FamilyAgnosticBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface FamilyAgnosticTicket {
  readonly ticketId: string;
  readonly sceneHash: string;
  readonly profileHash: string;
  readonly controllerFamily: ControllerFamily;
  readonly outputFormat: OutputFormat;
  readonly outputHash: string;
  readonly output: ControllerOutput;
  readonly machinePlanBounds: FamilyAgnosticBounds;
  readonly preflightHash: string;
  readonly createdAt: number;
}

export type FamilyMatchKind =
  | 'family-match'
  | 'controller-family-mismatch'
  | 'output-format-not-supported-by-controller';

export type FamilyMatchResult =
  | { ok: true; kind: 'family-match' }
  | {
      ok: false;
      kind: 'controller-family-mismatch' | 'output-format-not-supported-by-controller';
      expected: string;
      actual: string;
    };

/**
 * Pure capability-match validator. Replaces the theatre check at
 * `MachineService.ts:349-355` with a meaningful gate: family AND
 * output-format must both be supported by the connected controller.
 */
export function matchTicketToController(opts: {
  ticketFamily: ControllerFamily;
  ticketOutputFormat: OutputFormat;
  controllerFamily: ControllerFamily;
  controllerSupportedFormats: readonly OutputFormat[];
}): FamilyMatchResult {
  if (opts.controllerFamily !== opts.ticketFamily) {
    return {
      ok: false,
      kind: 'controller-family-mismatch',
      expected: opts.ticketFamily,
      actual: opts.controllerFamily,
    };
  }
  if (!opts.controllerSupportedFormats.includes(opts.ticketOutputFormat)) {
    return {
      ok: false,
      kind: 'output-format-not-supported-by-controller',
      expected: opts.ticketOutputFormat,
      actual: opts.controllerSupportedFormats.join(','),
    };
  }
  return { ok: true, kind: 'family-match' };
}

/**
 * Adapter: build a FamilyAgnosticTicket from the legacy gcode-lines
 * shape. Used during migration so PipelineService can keep emitting
 * gcode-lines while downstream consumers move to the new shape.
 */
export function ticketFromGcodeLines(opts: {
  ticketId: string;
  sceneHash: string;
  profileHash: string;
  outputHash: string;
  preflightHash: string;
  gcodeLines: readonly string[];
  controllerFamily: ControllerFamily;
  machinePlanBounds: FamilyAgnosticBounds;
  createdAt: number;
}): FamilyAgnosticTicket {
  return {
    ticketId: opts.ticketId,
    sceneHash: opts.sceneHash,
    profileHash: opts.profileHash,
    controllerFamily: opts.controllerFamily,
    outputFormat: 'gcode-lines',
    outputHash: opts.outputHash,
    output: { kind: 'gcode-lines', lines: opts.gcodeLines },
    machinePlanBounds: opts.machinePlanBounds,
    preflightHash: opts.preflightHash,
    createdAt: opts.createdAt,
  };
}

/**
 * Back-compat helper: derive gcode lines from a ticket when its
 * output is in a gcode-shaped format. Returns null for binary /
 * job-upload tickets — caller must branch on outputFormat.
 */
export function gcodeLinesFromTicket(ticket: FamilyAgnosticTicket): readonly string[] | null {
  if (ticket.output.kind === 'gcode-lines') return ticket.output.lines;
  if (ticket.output.kind === 'gcode-text') return ticket.output.text.split('\n');
  return null;
}

export function gcodeTextFromTicket(ticket: FamilyAgnosticTicket): string | null {
  if (ticket.output.kind === 'gcode-text') return ticket.output.text;
  if (ticket.output.kind === 'gcode-lines') return ticket.output.lines.join('\n');
  return null;
}

/** Output byte size — used by job-log size-budget logic. */
export function outputByteSize(output: ControllerOutput): number {
  switch (output.kind) {
    case 'gcode-lines': {
      let total = 0;
      for (const l of output.lines) total += l.length + 1;
      return total;
    }
    case 'gcode-text':
      return output.text.length;
    case 'binary-stream':
      return output.bytes.length;
    case 'job-upload':
      return output.payload.length;
  }
}

export function familyMatchUserMessage(result: FamilyMatchResult): string | null {
  if (result.ok) return null;
  switch (result.kind) {
    case 'controller-family-mismatch':
      return `This job was compiled for a '${result.expected}' controller, but the connected controller is '${result.actual}'. Re-compile with the connected controller selected.`;
    case 'output-format-not-supported-by-controller':
      return `The connected controller does not support '${result.expected}' output format (supported: ${result.actual}). Re-compile or change controller settings.`;
  }
}
