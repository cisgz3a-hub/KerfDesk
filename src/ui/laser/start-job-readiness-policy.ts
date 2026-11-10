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
import { rotaryAxisOf } from '../../core/devices/rotary-axis';
import type { RotaryAxis } from '../../core/devices/rotary';
import {
  PREPARATION_COMPILED_SEGMENT_BUDGET,
  rotaryAppliesTo,
  type Job,
  type JobOriginPlacement,
  type JobPlacementSettings,
  type JobStartMode,
} from '../../core/job';
import { scenePreparationSize } from '../../core/job/preparation-complexity';
import { rasterPreparationTooComplex } from '../../core/job/raster-preparation-complexity';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES, type PreflightIssue } from '../../core/preflight';
import { laserModuleAbsentJobWarning } from '../../core/preflight/laser-module-readiness';
import { runCompiledWorkPreflight } from '../../core/preflight/compiled-work';
import {
  findRegistrationBoxes,
  machineKindOf,
  registrationRunState,
  type Project,
  type Scene,
} from '../../core/scene';
import { cncAccessoryStartIssue, cncOverrideStartIssue } from '../state/cnc-accessory-readiness';
import { placementOf } from '../state/registration-outline-run';
import type { StatusReportFieldsOff } from '../state/status-report-fields';
import { detectCncParkZTopWarnings } from './cnc-park-z-top';
import {
  reportedAxesOf,
  rotaryAxisMissingIssue,
  rotaryAxisStartWarnings,
} from './rotary-axis-start-warnings';
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
  // ADR-695: an A or Z rotary no one has seen turn, or an A1 Pro rotary left on Y.
  warnings.push(...rotaryAxisStartWarnings(project));
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
// picture (ADR-228 Amendment 1), on a Place Board outline (ADR-654 Amendment
// 3) or against a registration jig's outline (ADR-654 Amendment 4, ADR-057
// Amendment 6). Said in Job Review, never refused.
function placementWarnings(
  project: Project,
  machine: Pick<
    MachineStartSnapshot,
    'cameraPlacementActive' | 'cameraMovedWarning' | 'cameraTargetOnCanvas' | 'registrationOutline'
  >,
  jobOrigin: JobOriginPlacement | undefined,
): string[] {
  const layout = registrationLayout(project);
  // The outline's own Start from is the one advice that keeps the artwork in
  // the burned outline, so it stands in for the camera warning.
  const outline = layout === 'jig' ? registrationOutlineWarning(project, machine, jobOrigin) : null;
  const rotary = rotaryAppliesTo(project.device, project.machine)
    ? rotaryAxisOf(project.device.rotary)
    : null;
  return [
    outline ?? cameraPlacementStartFromWarning(machine, jobOrigin, layout, rotary),
    layout === 'place-board' ? placeBoardAbsoluteWarning(jobOrigin) : null,
    machine.cameraTargetOnCanvas === true ? cameraTargetStartFromWarning(jobOrigin) : null,
    // ADR-663 Amendment 5: artwork placed on a picture from a camera that may
    // have moved may burn away from where it shows.
    machine.cameraPlacementActive === true ? (machine.cameraMovedWarning ?? null) : null,
  ].filter((warning): warning is string => warning !== null);
}

type RegistrationLayout = 'place-board' | 'jig' | null;

/** ADR-441 Amendment 10 (rolling audit v13 Y3-P1-2): the camera target's rings
 * are labelled at the photo by where the target put them, which only Absolute
 * Coordinates burns. Said here; the photo step refuses rings not seen to burn
 * there. */
export function cameraTargetStartFromWarning(
  jobOrigin: JobOriginPlacement | undefined,
): string | null {
  if (jobOrigin === undefined || jobOrigin.startFrom === 'absolute') return null;
  const mode = START_FROM_NAMES[jobOrigin.startFrom];
  return `These are the camera calibration target's rings, and Start from is ${mode}. The calibration photo reads each ring as burned where the target put it on the bed, which only Absolute Coordinates does: from ${mode} they burn somewhere else, and the calibration photo will refuse them. Choose Absolute Coordinates, and watch the Frame.`;
}

// A Place Board outline (ADR-124, ADR-654) anchors the job to the board; any
// other registration outline is the two-run jig (ADR-057), anchored the same way.
function registrationLayout(project: Project): RegistrationLayout {
  const boxes = findRegistrationBoxes(project.scene);
  if (boxes.length === 0) return null;
  return boxes.some((box) => box.provenance === 'captured-board') ? 'place-board' : 'jig';
}

/**
 * The camera picture shows absolute bed positions, so artwork placed on it
 * burns there only from Absolute Coordinates (ADR-228 Amendment: camera
 * placement is said in Job Review, never refused). LightBurn expects Absolute
 * Coordinates for camera placement for the same reason. A Place Board job is
 * the exception: it is laid out on the board's outline and burns on the board
 * from User Origin, so it is told that instead (ADR-654 Amendment 3). A
 * registration jig is the other: both runs anchor to its outline, so the
 * artwork run must keep the outline's Start from (ADR-654 Amendment 4).
 * An active rotary comes before all of these (ADR-228 Amendments 2 and 3):
 * what each Start from does along and around the cylinder depends on the
 * axis that turns it. No jobOrigin is how Start resolves Absolute.
 */
export function cameraPlacementStartFromWarning(
  machine: Pick<MachineStartSnapshot, 'cameraPlacementActive'>,
  jobOrigin: JobOriginPlacement | undefined,
  layout: RegistrationLayout = null,
  rotary: RotaryAxis | null = null,
): string | null {
  if (machine.cameraPlacementActive !== true) return null;
  if (rotary !== null) return rotaryCameraWarning(jobOrigin?.startFrom ?? 'absolute', rotary);
  if (jobOrigin === undefined || jobOrigin.startFrom === 'absolute') return null;
  if (layout === 'place-board') return placeBoardCameraWarning(jobOrigin.startFrom);
  if (layout === 'jig') return jigCameraWarning(jobOrigin.startFrom);
  return `Camera placement is on, but Start from is ${START_FROM_NAMES[jobOrigin.startFrom]}. The camera picture shows positions on the bed, so this job burns where ${START_FROM_NAMES[jobOrigin.startFrom]} puts it, not where the artwork sits on the camera picture. Choose Absolute Coordinates to burn it where it is placed, and watch the Frame.`;
}

// Where each placed Start from puts the job, along and around the cylinder.
const ROTARY_PLACED_AT: Readonly<Record<Exclude<JobStartMode, 'absolute'>, string>> = {
  'current-position': 'at the head',
  'user-origin': 'at your User Origin',
  'verified-origin': 'at your Verified Origin',
};

function rotaryLead(axis: RotaryAxis): string {
  return `Camera placement is on, and so is the rotary (turned by ${axis}).`;
}

/**
 * ADR-228 Amendments 2 and 3 (rolling audit v11 W4-P2-1, v13 Y3-P1-1). The
 * camera picture places the artwork along the cylinder (X); the turn is set
 * by Start from. A placed Start from also moves the job along the cylinder to
 * the head or the origin, away from the picture.
 *
 * - On A or Z every job first declares the current turn as zero (ADR-695), so
 *   Absolute keeps the picture's place along the cylinder and starts on the
 *   face under the laser: it is the advice, and needs no warning.
 * - On Y, Absolute rebases the turn to work Y 0 (ADR-127) and a placed Start
 *   from re-centres X on the head or origin: no one mode keeps both, so the
 *   head goes over the artwork on the picture first.
 */
export function rotaryCameraWarning(
  startFrom: JobStartMode,
  axis: RotaryAxis = 'Y',
): string | null {
  if (axis !== 'Y') {
    if (startFrom === 'absolute') return null;
    const mode = START_FROM_NAMES[startFrom];
    return `${rotaryLead(axis)} ${mode} puts the job ${ROTARY_PLACED_AT[startFrom]} along the cylinder, not where the artwork sits on the camera picture. On an ${axis} rotary, Absolute Coordinates burns it where it sits on the picture and still starts on the face under the laser, because every job first sets that turn as ${axis} 0. Choose Absolute Coordinates, turn the face to engrave under the laser, and watch the Frame.`;
  }
  if (startFrom === 'absolute') {
    return `${rotaryLead(axis)} Absolute Coordinates keeps the artwork where it sits on the camera picture along the cylinder, but turns the cylinder back so the job starts at work Y 0, not on the face under the laser, and neither the preview nor the canvas Frame outline shows that turn. On a Y rotary no Start from keeps both: jog the head over the artwork on the camera picture, turn the face to engrave under the laser, then choose Current Position, and watch the Frame. If no rotary is fitted, switch Rotary off beside Start first.`;
  }
  const mode = START_FROM_NAMES[startFrom];
  const set =
    startFrom === 'current-position'
      ? 'Jog the head over the artwork on the camera picture first'
      : `Set ${mode} with the head over the artwork on the camera picture`;
  return `${rotaryLead(axis)} ${mode} starts the job on the face of the cylinder ${ROTARY_PLACED_AT[startFrom]}, and puts it ${ROTARY_PLACED_AT[startFrom]} along the cylinder too, not where the artwork sits on the camera picture. ${set}, and watch the Frame. Do not choose Absolute Coordinates: on a Y rotary it turns the cylinder back to work Y 0 before burning.`;
}

function jigCameraWarning(startFrom: Exclude<JobStartMode, 'absolute'>): string {
  return `Camera placement is on, but this is a registration jig job: it burns where ${START_FROM_NAMES[startFrom]} puts the jig outline, not where the outline shows on the camera picture, and the artwork keeps its place inside the outline. Burn the outline and the artwork from the same Start from and work origin, and do not switch to Absolute Coordinates between the runs. Lay the artwork out inside the outline on the canvas, and watch the Frame.`;
}

/** The artwork run burns inside the outline only from the Start from and job
 * origin the outline burned with (ADR-057 Amendment 6), camera or not. */
function registrationOutlineWarning(
  project: Project,
  machine: Pick<MachineStartSnapshot, 'registrationOutline'>,
  jobOrigin: JobOriginPlacement | undefined,
): string | null {
  const outline = machine.registrationOutline;
  if (outline == null || registrationRunState(project.scene) !== 'artwork') return null;
  const artwork = placementOf(jobOrigin);
  if (samePlacement(outline, artwork)) return null;
  return `The jig outline burned from ${placementWords(outline)}, but this artwork run starts from ${placementWords(artwork)}. The artwork lands inside the burned outline only when both runs burn from the same Start from and job origin. Choose ${placementWords(outline)} again, keep the work origin unchanged, and watch the Frame.`;
}

function samePlacement(a: JobPlacementSettings, b: JobPlacementSettings): boolean {
  return a.startFrom === b.startFrom && (a.startFrom === 'absolute' || a.anchor === b.anchor);
}

function placementWords(placement: JobPlacementSettings): string {
  return placement.startFrom === 'absolute'
    ? 'Absolute Coordinates'
    : `${START_FROM_NAMES[placement.startFrom]} with the job origin at ${placement.anchor.replace('-', ' ')}`;
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

/** Every factual refusal of a built Start program: its integrity, and a rotary
 * on an axis the controller's own report does not have (ADR-695). */
export function preparedStartRefusal(
  gcode: string,
  preflight: Parameters<typeof preparedProgramIntegrityIssue>[2],
  project: Pick<Project, 'device' | 'machine'>,
  machine: Pick<MachineStartSnapshot, 'activeControllerKind' | 'statusReport'> &
    Pick<MachineStartSnapshot, 'reportedAxisLetters'>,
): ReadonlyArray<string> | null {
  const integrity = preparedProgramIntegrityIssue(
    gcode,
    project.device.rxBufferBytes,
    preflight,
    machine.activeControllerKind,
  );
  if (integrity !== null) return integrity;
  const axis = rotaryAxisMissingIssue(project, reportedAxesOf(machine));
  return axis === null ? null : [axis];
}
