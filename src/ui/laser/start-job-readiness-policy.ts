// Frame-first policy helpers kept separate from the Start preparation pipeline.
// They classify former policy blockers as Job Review warnings while preserving
// the small set of emit failures that cannot produce an executable program.

import {
  findOversizedLine,
  type OverrideValues,
  type StatusReport,
} from '../../core/controllers/grbl';
import {
  findLineBufferOverflow,
  lineBufferOverflowMessage,
} from '../../core/controllers/grbl/line-buffer-limit';
import {
  findFirstUnencodableSendableLine,
  hasSendableGcodeLine,
  unencodableLineMessage,
} from '../../core/controllers/grbl/sendable-line-scan';
import type { ControllerKind } from '../../core/devices';
import {
  PREPARATION_COMPILED_SEGMENT_BUDGET,
  type Job,
  type JobOriginPlacement,
  type JobStartMode,
} from '../../core/job';
import { scenePreparationSize } from '../../core/job/preparation-complexity';
import { rasterPreparationTooComplex } from '../../core/job/raster-preparation-complexity';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES, type PreflightIssue } from '../../core/preflight';
import { laserModuleAbsentJobWarning } from '../../core/preflight/laser-module-readiness';
import { runCompiledWorkPreflight } from '../../core/preflight/compiled-work';
import { findRegistrationBoxes, machineKindOf, type Project, type Scene } from '../../core/scene';
import { cncAccessoryStartIssue, cncOverrideStartIssue } from '../state/cnc-accessory-readiness';
import type { StatusReportFieldsOff } from '../state/status-report-fields';
import { detectCncParkZTopWarnings } from './cnc-park-z-top';
import { cncWorkZeroStartIssue } from './cnc-start-advisories';
import type { MachineStartSnapshot } from './start-job-readiness';

export const CNC_REQUIRES_GRBL_MESSAGE =
  'CNC jobs require a GRBL-family controller (GRBL, grblHAL, FluidNC). The connected firmware does not accept the GRBL CNC dialect — e.g. it reads the G4 spin-up dwell in milliseconds instead of seconds, so the bit would plunge before the spindle is at speed.';

export function demotedPolicyWarnings(
  project: Project,
  machine: MachineStartSnapshot,
  jobOrigin?: JobOriginPlacement,
): string[] {
  const warnings: string[] = placementWarnings(project, machine, jobOrigin);
  const machineKind = machineKindOf(project.machine);
  if (machineKind === 'cnc' && machine.cncJobsSupported === false) {
    warnings.push(CNC_REQUIRES_GRBL_MESSAGE);
  }
  // A board without its Laser module runs the job with the laser off
  // (controller audit SM-3): stated, never refused (ADR-397).
  const noLaserModule =
    machineKind === 'laser' ? laserModuleAbsentJobWarning(machine.laserModuleReport) : null;
  if (noLaserModule !== null) warnings.push(noLaserModule);
  warnings.push(
    ...cncOverrideStartIssues(project, machine.ovCache, machine.statusReportFieldsOff ?? null),
  );
  warnings.push(...cncAccessoryStartIssues(project, machine.accessoryCache));
  const workZeroIssue = cncWorkZeroStartIssue(
    project,
    machine.workZZeroEvidence,
    machine.workZReferenceEpoch,
    machine.controllerSessionEpoch,
  );
  if (workZeroIssue !== null) warnings.push(workZeroIssue);
  // ADR-491 Amendment 2: the park lift against the live top of Z travel.
  warnings.push(...detectCncParkZTopWarnings(project, machine));
  return warnings;
}

const START_FROM_NAMES: Readonly<Record<Exclude<JobStartMode, 'absolute'>, string>> = {
  'current-position': 'Current Position',
  'user-origin': 'User Origin',
  'verified-origin': 'Verified Origin',
};

// Where the job burns against where the operator laid it out: on the camera
// picture (ADR-228 Amendment 1) or on a Place Board outline (ADR-654
// Amendment 2). Said in Job Review, never refused.
function placementWarnings(
  project: Project,
  machine: Pick<MachineStartSnapshot, 'cameraPlacementActive'>,
  jobOrigin: JobOriginPlacement | undefined,
): string[] {
  const placeBoard = hasPlaceBoardOutline(project);
  return [
    cameraPlacementStartFromWarning(machine, jobOrigin, placeBoard),
    placeBoard ? placeBoardAbsoluteWarning(jobOrigin) : null,
  ].filter((warning): warning is string => warning !== null);
}

// A Place Board outline (ADR-124, ADR-654) anchors the job to the board.
function hasPlaceBoardOutline(project: Project): boolean {
  return findRegistrationBoxes(project.scene).some((box) => box.provenance === 'captured-board');
}

/**
 * The camera picture shows absolute bed positions, so artwork placed on it
 * burns there only from Absolute Coordinates (ADR-228 Amendment: camera
 * placement is said in Job Review, never refused). LightBurn expects Absolute
 * Coordinates for camera placement for the same reason. A Place Board job is
 * the exception: it is laid out on the board's outline and burns on the board
 * from User Origin, so it is told that instead (ADR-654 Amendment 2).
 */
export function cameraPlacementStartFromWarning(
  machine: Pick<MachineStartSnapshot, 'cameraPlacementActive'>,
  jobOrigin: JobOriginPlacement | undefined,
  placeBoard = false,
): string | null {
  if (machine.cameraPlacementActive !== true || jobOrigin === undefined) return null;
  if (jobOrigin.startFrom === 'absolute') return null;
  if (placeBoard) return placeBoardCameraWarning(jobOrigin.startFrom);
  return `Camera placement is on, but Start from is ${START_FROM_NAMES[jobOrigin.startFrom]}. The camera picture shows positions on the bed, so this job burns where ${START_FROM_NAMES[jobOrigin.startFrom]} puts it, not where the artwork sits on the camera picture. Choose Absolute Coordinates to burn it where it is placed, and watch the Frame.`;
}

function placeBoardCameraWarning(startFrom: Exclude<JobStartMode, 'absolute'>): string {
  const outline =
    'Camera placement is on, but this job is laid out on the Place Board outline, which sits centred on the canvas, not where the board shows on the camera picture.';
  return startFrom === 'user-origin'
    ? `${outline} It burns on the board that Place Board registered at User Origin. Lay the artwork out on the outline, not on the board in the camera picture, and watch the Frame.`
    : `${outline} It burns where ${START_FROM_NAMES[startFrom]} puts the outline, not on the board that Place Board registered at User Origin. Choose User Origin to burn it on the board, lay the artwork out on the outline rather than on the camera picture, and watch the Frame.`;
}

export const PLACE_BOARD_ABSOLUTE_WARNING =
  'This job is laid out on the Place Board outline, but Start from is Absolute Coordinates, so it burns where the outline sits on the canvas, not on the board: the outline is centred on the canvas, not drawn where the board lies on the bed. Place Board registers the board at User Origin, so choose User Origin to burn it on the board, and watch the Frame.';

/** Absolute Coordinates burn a Place Board job at its centred outline, off the board. */
export function placeBoardAbsoluteWarning(
  jobOrigin: JobOriginPlacement | undefined,
): string | null {
  return jobOrigin === undefined || jobOrigin.startFrom === 'absolute'
    ? PLACE_BOARD_ABSOLUTE_WARNING
    : null;
}

export const LARGE_JOB_PREPARATION_WARNING =
  'Large job: this design is over the live preview and estimate budget, so those stay paused. Preparing and streaming the program may take longer than usual.';

export const LARGE_RASTER_PREPARATION_WARNING =
  'Very large image: this engraving is over the live preview and estimate budget, so those stay paused. Preparing and streaming may take several minutes.';

// The former pre-emit curve/fill segment budget refusal, demoted to a Job
// Review advisory (rule 7 / ADR-241): the operator is informed, never blocked.
// When the bounded fill estimate cannot count (work budget exhausted), the size
// is unknown, not large: the compiled job's real Fill span count decides
// (ADR-459 Amd 1). Without a compiled job an unknown size stays silent.
export function largeJobPreparationWarning(scene: Scene, job?: Job): string | null {
  const size = scenePreparationSize(scene);
  if (size === 'over-budget') return LARGE_JOB_PREPARATION_WARNING;
  if (size === 'unknown' && job !== undefined && compiledFillSpansOverBudget(job)) {
    return LARGE_JOB_PREPARATION_WARNING;
  }
  return null;
}

// The compiled counterpart of the scene fill estimate: actual Fill spans,
// counted only until the budget is passed.
function compiledFillSpansOverBudget(job: Job): boolean {
  let spans = 0;
  for (const group of job.groups) {
    if (group.kind !== 'fill') continue;
    spans += group.segments.length;
    if (spans > PREPARATION_COMPILED_SEGMENT_BUDGET) return true;
  }
  return false;
}

// The former pre-emit raster-too-large refusal, demoted the same way
// (ADR-243): any pixel size streams; the operator is told it will be slow.
export function largeRasterPreparationWarning(project: Project): string | null {
  return rasterPreparationTooComplex(project) ? LARGE_RASTER_PREPARATION_WARNING : null;
}

// The former prepareOutput compiled-work refusal (motion segments / estimated
// program bytes), demoted to Job Review advisories (ADR-243). The measurement
// stays bounded: it stops counting once past its limits, and the messages say
// "at least" when it does.
export function compiledWorkAdvisories(job: Job): ReadonlyArray<string> {
  return runCompiledWorkPreflight(job).issues.map((issue) => issue.message);
}

// Canonical set lives in core/preflight so the Start and Save paths cannot
// drift apart (they did — see save-preflight-policy.ts).
const EMIT_BLOCKING_PREFLIGHT_CODES: ReadonlySet<string> = COMPILE_INTEGRITY_PREFLIGHT_CODES;

export function partitionEmitPreflight(preflight: {
  readonly issues: ReadonlyArray<PreflightIssue>;
}): {
  readonly blocking: string[];
  readonly warnings: string[];
} {
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const issue of preflight.issues) {
    (EMIT_BLOCKING_PREFLIGHT_CODES.has(issue.code) ? blocking : warnings).push(issue.message);
  }
  return { blocking, warnings };
}

function cncAccessoryStartIssues(
  project: Project,
  accessories: NonNullable<StatusReport['accessories']> | null | undefined,
): ReadonlyArray<string> {
  const issue = cncAccessoryStartIssue(machineKindOf(project.machine), accessories);
  return issue === null ? [] : [issue];
}

function cncOverrideStartIssues(
  project: Project,
  overrides: OverrideValues | null | undefined,
  fieldsOff: StatusReportFieldsOff | null,
): ReadonlyArray<string> {
  const issue = cncOverrideStartIssue(machineKindOf(project.machine), overrides, fieldsOff);
  return issue === null ? [] : [issue];
}

/** The program-text failures that can never stream or run: nothing sendable,
 * one line longer than the controller's receive buffer, one carrying a byte the
 * serial wire cannot send as text, or one longer than the connected
 * controller's line buffer. Everything else the emitter reports is a Job
 * Review warning (ADR-228). */
export function preparedProgramIntegrityIssue(
  gcode: string,
  rxBufferBytes: number,
  preflight: { readonly issues: ReadonlyArray<{ readonly message: string }> },
  activeControllerKind: ControllerKind | undefined,
): ReadonlyArray<string> | null {
  if (!hasSendableGcodeLine(gcode)) {
    return nonExecutableProgramMessages(preflight);
  }
  const oversized = findOversizedLine(gcode, rxBufferBytes);
  if (oversized !== null) {
    return [
      `G-code line ${oversized.lineNumber} is ${oversized.bytes} bytes — longer than the ` +
        `controller's ${oversized.limit}-byte RX buffer; it can never be sent. Job not framed or started.`,
    ];
  }
  const unencodable = findFirstUnencodableSendableLine(gcode);
  if (unencodable !== null) {
    return [`${unencodableLineMessage(unencodable)} Job not framed or started.`];
  }
  // Refusal (a) under PROJECT.md non-negotiable 21: the connected controller
  // answers the line with error:11 and never runs it. Start refuses it too
  // (assertGcodeFitsController); saying so here stops Frame first (controller
  // audit S-3, ADR-375).
  const overflow = findLineBufferOverflow(gcode, activeControllerKind);
  return overflow === null
    ? null
    : [`${lineBufferOverflowMessage(overflow)} Job not framed or started.`];
}

function nonExecutableProgramMessages(preflight: {
  readonly issues: ReadonlyArray<{ readonly message: string }>;
}): ReadonlyArray<string> {
  const messages = preflight.issues.map((issue) => issue.message);
  return messages.length > 0
    ? messages
    : ['The prepared job contains no executable controller commands. Nothing was framed or sent.'];
}
