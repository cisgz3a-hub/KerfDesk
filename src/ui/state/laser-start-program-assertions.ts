// laser-start-program-assertions — assert a compiled program may be started,
// extracted from laser-job-actions.ts when it reached the 400-line file cap.
//
// Every function here is a leaf check over (gcode, options) alone: none reads
// or writes store state, so they carry no set/get and stay independently
// testable. Each throws the operator-facing message on violation, matching the
// throw-to-reject contract prepareStartBoundary already relies on.
//
// Rule 7 note: these are not policy gates. They are compile-integrity and
// handoff-consistency checks — the program factually cannot be produced or
// streamed, or the reviewed evidence does not bind to these bytes.

import { findOversizedLine, isSendableGcodeLine } from '../../core/controllers/grbl';
import {
  findLineBufferOverflow,
  lineBufferOverflowMessage,
} from '../../core/controllers/grbl/line-buffer-limit';
import {
  findFirstUnencodableSendableLine,
  unencodableLineMessage,
} from '../../core/controllers/grbl/sendable-line-scan';
import { findFluidncNonExecutableLines } from '../../core/controllers/fluidnc/fluidnc-line-limit';
import type { ControllerDriver } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import {
  CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE,
  cncSetupAttestationMatches,
  type CncControllerEpoch,
} from './cnc-setup-attestation';
import { laserModeStartEvidenceIssue } from './laser-mode-start-evidence';
import { normalizeStartJobOptions } from './laser-job-options';
import type { StartJobOptions } from './laser-store';

export const EMPTY_PROGRAM_MESSAGE = 'The job contains no sendable G-code commands.';

/** Throws when the program carries no line the streamer could ever send. */
export function assertProgramHasSendableLine(gcode: string): void {
  if (gcode.split('\n').some(isSendableGcodeLine)) return;
  throw new Error(EMPTY_PROGRAM_MESSAGE);
}

/**
 * Throws when the reviewed laser-mode evidence does not bind to these exact
 * bytes. CNC output carries its own attestation instead.
 */
export function assertStartControllerEvidence(
  machineKind: 'laser' | 'cnc',
  options: StartJobOptions,
  gcode: string,
): void {
  // M7 support is a Job Review advisory (rule 7 / ADR-228), not a wire-boundary
  // refusal, so there is no live controller re-check here. For laser output the
  // reviewed evidence still gates handoff consistency ($30/$32 acknowledgement
  // and unchanged M7 program shape).
  if (machineKind !== 'laser') return;
  const issue = laserModeStartEvidenceIssue(options.laserModeStartEvidence, gcode);
  if (issue !== null) throw new Error(issue);
}

/** Throws when a single line exceeds the controller's RX buffer or its parser's
 * line buffer, so it could never be streamed or never run. */
export function assertGcodeFitsController(
  gcode: string,
  options: StartJobOptions,
  activeControllerKind?: ControllerKind,
): void {
  const streamOptions = normalizeStartJobOptions(options);
  const oversized = findOversizedLine(gcode, streamOptions.rxBufferBytes);
  if (oversized !== null) {
    throw new Error(
      `G-code line ${oversized.lineNumber} is ${oversized.bytes} bytes — longer than the ` +
        `controller's ${oversized.limit}-byte RX buffer; it can never be sent. Job not started.`,
    );
  }
  const unencodable = findFirstUnencodableSendableLine(gcode);
  if (unencodable !== null) {
    throw new Error(`${unencodableLineMessage(unencodable)} Job not started.`);
  }
  // PROJECT.md non-negotiable 21, refusal (a): stock GRBL and grblHAL answer a
  // line past their line buffer with error:11 and never run it, so the job
  // would stop there (controller audit S-3, ADR-375).
  const overflow = findLineBufferOverflow(gcode, activeControllerKind);
  if (overflow !== null) throw new Error(`${lineBufferOverflowMessage(overflow)} Job not started.`);
  if (activeControllerKind !== 'fluidnc') return;
  const rejected = findFluidncNonExecutableLines(gcode)[0];
  if (rejected === undefined) return;
  throw new Error(
    `G-code line ${rejected.lineNumber} has a ${rejected.length}-byte executable payload — FluidNC accepts at most 127 bytes before error:14. Job not started.`,
  );
}

export function assertActiveDriverAcceptsMachineKind(
  machineKind: 'laser' | 'cnc',
  driver: Pick<ControllerDriver, 'label' | 'capabilities'>,
): void {
  if (machineKind !== 'cnc' || driver.capabilities.cncJobs) return;
  throw new Error(
    `${driver.label} cannot accept LaserForge CNC jobs. No controller or program bytes were sent.`,
  );
}

/** Throws when the CNC setup attestation does not bind this program to this controller epoch. */
export function assertCncSetupAttested(
  gcode: string,
  options: StartJobOptions,
  controllerEpoch: CncControllerEpoch,
): void {
  if (options.machineKind !== 'cnc') return;
  if (cncSetupAttestationMatches(options.cncSetupAttestation, gcode, controllerEpoch)) return;
  throw new Error(CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE);
}
