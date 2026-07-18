import { buildCncFrameMotion, type CncFrameMotionPlan } from './cnc-frame-lines';
import { currentWorkZMm } from './infer-machine-position';
import { useStore } from './store';
import { isWorkZEvidenceCurrentForStart } from './work-z-zero-evidence';
import type { LaserState, LiveRefs } from './laser-store';

const FRAME_RETURN_EPSILON_MM = 1e-3;

// Ordered Frame line list for dispatch. Every controller first receives its
// driver-owned tool-off sequence under the same watched/acknowledged operation
// as the motion. Laser projects then trace the driver's Z-silent XY perimeter;
// CNC projects wrap it with a safe-Z retract (the bit would otherwise drag
// through stock) and restore to the pre-frame Z (ADR-192). Only driver-produced
// protocol bytes are ordered here (ADR-094).
export function buildFrameDispatchPlan(
  refs: LiveRefs,
  get: () => LaserState,
  bounds: Parameters<LaserState['frame']>[0],
  feed: number,
  candidate: Parameters<LaserState['frame']>[2],
): CncFrameMotionPlan {
  const toolOffLines = refs.driver.commands.frameToolOffLines.map((line) => `${line}\n`);
  const perimeter = refs.driver.commands.buildFrameLines(bounds, feed);
  const returnLine = frameReturnLine(refs, bounds, feed, candidate?.returnToWorkPosition);
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') {
    return {
      kind: 'ready',
      lines:
        returnLine === undefined
          ? [...toolOffLines, ...perimeter]
          : [...toolOffLines, ...perimeter, returnLine],
    };
  }
  const state = get();
  const motion = buildCncFrameMotion({
    perimeter,
    ...(returnLine === undefined ? {} : { returnLine }),
    safeZMm: machine.params.safeZMm,
    preFrameWorkZMm: currentWorkZMm(state.statusReport, state.wcoCache),
    hasCurrentWorkZEvidence: isWorkZEvidenceCurrentForStart(
      state.workZZeroEvidence,
      state.workZReferenceEpoch,
      state.controllerSessionEpoch,
    ),
    buildRetract: refs.driver.commands.buildFrameRetract,
    feed,
  });
  if (motion.kind === 'blocked') return motion;
  return { kind: 'ready', lines: [...toolOffLines, ...motion.lines] };
}

function frameReturnLine(
  refs: LiveRefs,
  bounds: Parameters<LaserState['frame']>[0],
  feed: number,
  target: { readonly x: number; readonly y: number } | undefined,
): string | undefined {
  if (target === undefined) return undefined;
  if (
    Math.abs(target.x - bounds.minX) < FRAME_RETURN_EPSILON_MM &&
    Math.abs(target.y - bounds.minY) < FRAME_RETURN_EPSILON_MM
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
