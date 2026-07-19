import type { StatusReport } from '../../core/controllers/grbl';
import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import {
  computeJobBounds,
  computeJobMotionBounds,
  describeFramePreflightFailure,
  framePreflight,
  machineSpaceJob,
  offsetJobBounds,
  type JobBounds,
} from '../../core/job';
import { runPreflight } from '../../core/preflight';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import type { StartJobPreparation } from './start-job-readiness';

type PreparedFrameCandidate = Extract<StartJobPreparation, { readonly ok: true }>;

type FrameMachinePosition = {
  readonly statusReport: StatusReport | null;
  readonly wcoCache: WorkCoordinateOffset | null;
  readonly reportInches: boolean;
};

export type FrameCandidatePreflight =
  | {
      readonly ok: true;
      readonly jobBounds: JobBounds;
      readonly motionBounds: JobBounds;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

/** Proves the reviewed Frame and its full job path stay clear in machine XY. */
export function preflightFrameCandidate(
  preparation: PreparedFrameCandidate,
  machine: FrameMachinePosition,
): FrameCandidatePreflight {
  const prepared = preparation.prepared;
  const project = prepared.project;
  const framedJob = machineSpaceJob(prepared.job, project.device, project.machine);
  const jobBounds = computeJobBounds(framedJob, project.device);
  if (jobBounds === null) {
    return { ok: false, messages: ['Nothing to frame — enable Output on at least one layer.'] };
  }
  const motionBounds = computeJobMotionBounds(framedJob, project.device) ?? jobBounds;
  const physicalMotionBounds =
    preparation.preflightMotionOffset === undefined
      ? motionBounds
      : offsetJobBounds(motionBounds, preparation.preflightMotionOffset);
  const perimeterIssue = framePerimeterIssue(physicalMotionBounds, project.device);
  if (perimeterIssue !== null) return { ok: false, messages: [perimeterIssue] };
  const pathIssues = fullJobNoGoIssues(preparation, machine);
  if (pathIssues.length > 0) return { ok: false, messages: pathIssues };
  return { ok: true, jobBounds, motionBounds };
}

function framePerimeterIssue(
  motionBounds: JobBounds,
  device: PreparedFrameCandidate['prepared']['project']['device'],
): string | null {
  const result = framePreflight(motionBounds, device);
  if (result.kind === 'ok') return null;
  if (result.kind === 'out-of-bounds') return describeFramePreflightFailure(result);
  return (
    `Cannot frame: the Frame perimeter crosses no-go zone "${result.zoneName}". ` +
    'Move the job or fixture before trying again.'
  );
}

function fullJobNoGoIssues(
  preparation: PreparedFrameCandidate,
  machine: FrameMachinePosition,
): ReadonlyArray<string> {
  const project = preparation.prepared.project;
  if (!project.device.noGoZones.some((zone) => zone.enabled)) return [];
  const coordinateMode =
    preparation.jobOrigin !== undefined && preparation.preflightMotionOffset === undefined
      ? 'relative-origin'
      : 'machine';
  const preflight = runPreflight(project, preparation.gcode, {
    coordinateMode,
    ...(preparation.preflightMotionOffset === undefined
      ? {}
      : { motionOffset: preparation.preflightMotionOffset }),
    ...initialMachinePositionOption(machine),
  });
  return preflight.issues
    .filter((issue) => issue.code === 'no-go-zone-collision')
    .map((issue) => `Cannot frame: the reviewed job path is not clear. ${issue.message}`);
}

function initialMachinePositionOption(machine: FrameMachinePosition): {
  readonly initialMachinePosition?: { readonly x: number; readonly y: number };
} {
  const raw = inferCurrentMachinePosition(machine.statusReport, machine.wcoCache);
  if (raw === null || ![raw.x, raw.y, raw.z].every(Number.isFinite)) return {};
  const [x, y] = normalizeReportedMPosToMm([raw.x, raw.y, raw.z], machine.reportInches);
  return { initialMachinePosition: { x, y } };
}
