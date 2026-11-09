import { buildCncFrameMotion, type CncFrameMotionPlan } from './cnc-frame-lines';
import { frameMotionFeeds } from './frame-feed-limits';
import { frameBedEdgeWarning } from './frame-bed-edge-warning';
import { frameHomedAreaWarning } from './frame-homed-area-warning';
import { frameNoGoZoneWarnings } from './frame-no-go-warnings';
import { currentWorkZMm } from './infer-machine-position';
import { useStore } from './store';
import { isWorkZEvidenceCurrentForStart } from './work-z-zero-evidence';
import type { LaserState, LiveRefs } from './laser-store';
import type { FrameBounds } from '../../core/controllers/controller-driver';
import { buildFramePerimeter } from '../../core/job/frame-perimeter';
import { rotaryOutputAxis } from '../../core/job/rotary-job';
import type { Project } from '../../core/scene';
import {
  reportedControllerAxes,
  rotaryAxisBedFrameBounds,
  rotaryAxisFramePlan,
} from './rotary-axis-frame';

const FRAME_RETURN_EPSILON_MM = 1e-3;

// Ordered Frame line list for dispatch. Every controller first receives its
// driver-owned tool-off sequence under the same watched/acknowledged operation
// as the motion. Laser projects then trace the driver's Z-silent XY perimeter;
// CNC projects wrap it with a safe-Z retract (the bit would otherwise drag
// through stock) and restore only a nonnegative pre-frame Z (ADR-192). Only
// driver-produced protocol bytes are ordered here (ADR-094).
export function buildFrameDispatchPlan(
  refs: LiveRefs,
  get: () => LaserState,
  bounds: Parameters<LaserState['frame']>[0],
  feed: number,
  candidate: Parameters<LaserState['frame']>[2] | Parameters<LaserState['traceFrame']>[2],
  jobProject?: Parameters<LaserState['frame']>[3],
  external?: Parameters<LaserState['frame']>[5],
): CncFrameMotionPlan {
  const state = get();
  const feeds = frameMotionFeeds(feed, state.controllerSettings);
  const toolOffLines = refs.driver.commands.frameToolOffLines.map((line) => `${line}\n`);
  const project = framedProject(candidate, jobProject);
  const frameBounds = frameBoundsForProject(bounds, project);
  const perimeter = refs.driver.commands.buildFrameLines(frameBounds, feeds.xyMmPerMin);
  const returnLine = frameReturnLine(
    refs,
    frameBounds,
    feeds.xyMmPerMin,
    frameReturnTarget(candidate, external),
  );
  // The framed job decides laser or CNC motion. A recovery or second-pass Frame
  // of a saved laser job must not pick up a CNC safe-Z wrap because the open
  // canvas has since been switched to CNC, or the reverse.
  const machine = project.machine;
  const rotaryAxis = rotaryOutputAxis(project.device, machine);
  if (rotaryAxis !== null) {
    return rotaryAxisFramePlan({
      project,
      axis: rotaryAxis,
      toolOffLines,
      perimeter,
      bounds: frameBounds,
      returnTarget: frameReturnTarget(candidate, external),
      feed: feeds.xyMmPerMin,
      buildJog: refs.driver.commands.buildJog,
      reported: reportedControllerAxes(state),
    });
  }
  if (machine?.kind !== 'cnc') {
    return {
      kind: 'ready',
      lines:
        returnLine === undefined
          ? [...toolOffLines, ...perimeter]
          : [...toolOffLines, ...perimeter, returnLine],
    };
  }
  const motion = buildCncFrameMotion({
    perimeter,
    ...(returnLine === undefined ? {} : { returnLine }),
    safeZMm: machine.params.safeZMm,
    preFrameWorkZMm: currentWorkZMm(
      state.statusReport,
      state.wcoCache,
      state.controllerSettings?.reportInches === true,
    ),
    hasCurrentWorkZEvidence: isWorkZEvidenceCurrentForStart(
      state.workZZeroEvidence,
      state.workZReferenceEpoch,
      state.controllerSessionEpoch,
    ),
    buildRetract: refs.driver.commands.buildFrameRetract,
    zFeed: feeds.zMmPerMin,
    cncJobsSupported: refs.driver.capabilities.cncJobs,
  });
  if (motion.kind === 'blocked') return motion;
  return { ...motion, lines: [...toolOffLines, ...motion.lines] };
}

/** The configured no-go zones this Frame's route crosses (approach, perimeter
 * and return), and grblHAL's homed area (ADR-637 Amendment 5) or else the
 * configured bed (ADR-232 Amendment 2) when the route leaves it, for the same
 * project, start point and return leg buildFrameDispatchPlan sends. Warnings
 * only (ADR-232 Amendment 1). */
export function frameRouteNoGoWarnings(
  state: LaserState,
  bounds: Parameters<LaserState['frame']>[0],
  candidate: Parameters<LaserState['frame']>[2] | Parameters<LaserState['traceFrame']>[2],
  jobProject?: Parameters<LaserState['frame']>[3],
  external?: Parameters<LaserState['frame']>[5],
): ReadonlyArray<string> {
  const project = framedProject(candidate, jobProject);
  const returnTarget = frameReturnTarget(candidate, external);
  // A dedicated rotary axis turns the part; the head stays at its own Y
  // (ADR-695), so the bed and no-go checks see that Y, not the turn.
  const dedicatedAxis = rotaryOutputAxis(project.device, project.machine) !== null;
  if (dedicatedAxis && returnTarget === undefined) return [];
  const projectBounds = frameBoundsForProject(bounds, project);
  const frameBounds =
    dedicatedAxis && returnTarget !== undefined
      ? rotaryAxisBedFrameBounds(projectBounds, returnTarget.y)
      : projectBounds;
  // grblHAL's homed-area warning already names the bed it runs past.
  const bedArea =
    frameHomedAreaWarning(state, project, frameBounds, returnTarget) ??
    frameBedEdgeWarning(state, project, frameBounds, returnTarget);
  const noGo = frameNoGoZoneWarnings(state, project, frameBounds, returnTarget);
  return bedArea === null ? noGo : [...noGo, bedArea];
}

function framedProject(
  candidate: Parameters<typeof buildFrameDispatchPlan>[4],
  jobProject: Parameters<typeof buildFrameDispatchPlan>[5],
): Project {
  return candidate?.project ?? jobProject ?? useStore.getState().project;
}

function frameBoundsForProject(bounds: FrameBounds, project: Project): FrameBounds {
  const startPoint = project.startPoints?.frame;
  return { ...bounds, ...(startPoint === undefined ? {} : { startPoint }) };
}

// A project Frame returns to its candidate's pre-Frame position; an external
// program's Frame (ADR-630) to where that program starts.
function frameReturnTarget(
  candidate: Parameters<typeof buildFrameDispatchPlan>[4],
  external: Parameters<typeof buildFrameDispatchPlan>[6],
): { readonly x: number; readonly y: number } | undefined {
  return candidate?.returnToWorkPosition ?? external?.returnToWorkPosition;
}

function frameReturnLine(
  refs: LiveRefs,
  bounds: FrameBounds,
  feed: number,
  target: { readonly x: number; readonly y: number } | undefined,
): string | undefined {
  if (target === undefined) return undefined;
  const start = buildFramePerimeter(bounds, bounds.startPoint)[0];
  if (
    Math.abs(target.x - start.x) < FRAME_RETURN_EPSILON_MM &&
    Math.abs(target.y - start.y) < FRAME_RETURN_EPSILON_MM
  ) {
    return undefined;
  }
  return `${refs.driver.commands.buildJog({
    dx: target.x,
    dy: target.y,
    feed,
    relative: false,
  })}\n`;
}
