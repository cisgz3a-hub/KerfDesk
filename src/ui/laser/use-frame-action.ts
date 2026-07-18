import type { DeviceProfile } from '../../core/devices';
import type { MotionBoundsOffset } from '../../core/invariants';
import { filterSceneForOutputScope } from '../../core/scene';
import {
  computeFrameBounds,
  computeJobBounds,
  computeJobMotionBounds,
  describeFramePreflightFailure,
  framePreflight,
  offsetJobBounds,
  type JobBounds,
} from '../../core/job';
import { prepareOutputSnapshot, type PreparedOutput } from '../../io/gcode';
import { trustedMotionOffsetForPreflight, type ResolvedJobPlacement } from '../job-placement';
import { currentOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { renderVariableText } from '../text/render-variable-text';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { resolveCameraSafeFramePlacement } from './camera-frame-placement';

export function useFrameAction(): () => void {
  const frame = useLaserStore((s) => s.frame);
  const statusReport = useLaserStore((s) => s.statusReport);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const homingState = useLaserStore((s) => s.homingState);
  const trustedPositionEpoch = useLaserStore((s) => s.trustedPositionEpoch ?? 0);
  const reportInches = useLaserStore((s) => s.controllerSettings?.reportInches === true);
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    void runFrameAction({
      frame,
      statusReport,
      workOriginActive,
      wcoCache,
      homingState,
      trustedPositionEpoch,
      reportInches,
      pushToast,
    });
  };
}

/** Imperative Frame run for non-hook callers (the blocked-Start fix offer).
 * True when the frame motion was dispatched — the physical trace continues
 * asynchronously afterwards, so callers must not assume the head is idle. */
export async function runFrameNow(): Promise<boolean> {
  const laser = useLaserStore.getState();
  return runFrameAction({
    frame: laser.frame,
    statusReport: laser.statusReport,
    workOriginActive: laser.workOriginActive,
    wcoCache: laser.wcoCache,
    homingState: laser.homingState,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    reportInches: laser.controllerSettings?.reportInches === true,
    pushToast: useToastStore.getState().pushToast,
  });
}

async function runFrameAction({
  frame,
  statusReport,
  workOriginActive,
  wcoCache,
  homingState,
  trustedPositionEpoch,
  reportInches,
  pushToast,
}: Pick<
  ReturnType<typeof useLaserStore.getState>,
  | 'frame'
  | 'statusReport'
  | 'workOriginActive'
  | 'wcoCache'
  | 'homingState'
  | 'trustedPositionEpoch'
> & {
  readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
  readonly reportInches: boolean;
}): Promise<boolean> {
  // Click-only consumer: read project/placement at call time instead of
  // subscribing; a render-per-mousemove for a button handler would be noisy.
  const app = useStore.getState();
  const { project, jobPlacement } = app;
  const outputScope = currentOutputScope(app);
  const placement = resolveCameraSafeFramePlacement(project, jobPlacement, {
    statusReport,
    workOriginActive,
    wcoCache,
    homingState,
    trustedPositionEpoch,
    reportInches,
  });
  if (!placement.ok) {
    pushToast(placement.messages[0] ?? 'Job origin cannot be resolved.', 'error');
    return false;
  }
  const frameScene = filterSceneForOutputScope(project.scene, outputScope);
  const frameBounds = computeFrameBounds(
    frameScene,
    project.device,
    placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin },
  );
  const registration = currentPrintCutOutputRegistration(project);
  const prepared = await prepareOutputSnapshot(project, {
    clock: () => new Date(),
    renderVariableText,
    ...(registration === undefined ? {} : { registration }),
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    outputScope,
  });
  if (!prepared.ok) {
    const fallbackBounds = rasterBudgetFallbackBounds(prepared.preflight, frameBounds);
    if (fallbackBounds !== null) {
      return dispatchFrameIfSafe(
        frame,
        pushToast,
        fallbackBounds,
        fallbackBounds,
        placement,
        project,
      );
    }
    pushToast(
      prepared.preflight.issues[0]?.message ?? 'Raster job is too large to frame.',
      'error',
    );
    return false;
  }
  const bounds = computeJobBounds(prepared.job, project.device);
  if (bounds === null) {
    pushToast('Nothing to frame — enable Output on at least one layer.', 'warning');
    return false;
  }
  const motionBounds = computeJobMotionBounds(prepared.job, project.device) ?? bounds;
  return dispatchFrameIfSafe(frame, pushToast, bounds, motionBounds, placement, project);
}

function rasterBudgetFallbackBounds(
  preflight: Extract<PreparedOutput, { readonly ok: false }>['preflight'],
  frameBounds: JobBounds | null,
): JobBounds | null {
  const rasterOnly =
    preflight.issues.length > 0 &&
    preflight.issues.every((issue) => issue.code === 'raster-too-large');
  return rasterOnly ? frameBounds : null;
}

async function dispatchFrameIfSafe(
  frame: (bounds: JobBounds, feed: number) => Promise<void>,
  pushToast: (message: string, variant: 'error') => void,
  bounds: JobBounds,
  motionBounds: JobBounds,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
  project: ReturnType<typeof useStore.getState>['project'],
): Promise<boolean> {
  const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);
  const motionIssue = describeFrameMotionPreflightIssue(
    motionBounds,
    motionOffset,
    placement.jobOrigin !== undefined,
    project.device,
  );
  if (motionIssue !== null) {
    pushToast(motionIssue, 'error');
    return false;
  }
  const feed = project.device.framingFeedMmPerMin;
  try {
    // Resolves when the first frame line is dispatched; the remaining trace
    // streams via status observations. Failures already surface through the
    // store's write-error log, matching the old silent .catch here.
    await frame(bounds, feed);
  } catch {
    return false;
  }
  // Frame-first (ADR-228 amendment): the store arms the proof on the frame
  // operation itself and records frameVerification only when the trace
  // settles cleanly — a cancelled, alarmed, or dropped trace earns nothing.
  return true;
}

function describeFrameMotionPreflightIssue(
  motionBounds: JobBounds,
  motionOffset: MotionBoundsOffset | undefined,
  hasRelativeOrigin: boolean,
  device: DeviceProfile,
): string | null {
  if (motionOffset === undefined && hasRelativeOrigin) {
    return describeRelativeMotionTooLarge(motionBounds, device);
  }
  const preflightBounds =
    motionOffset === undefined ? motionBounds : offsetJobBounds(motionBounds, motionOffset);
  const pre = framePreflight(preflightBounds, device);
  if (pre.kind === 'out-of-bounds') {
    return `${describeFramePreflightFailure(pre)} Generated motion includes overscan; move the artwork farther from the bed edge or reduce overscan after a test burn.`;
  }
  if (pre.kind === 'no-go-zone') {
    return `Cannot frame: generated motion crosses no-go zone "${pre.zoneName}".`;
  }
  return null;
}

function describeRelativeMotionTooLarge(
  bounds: JobBounds,
  device: { readonly bedWidth: number; readonly bedHeight: number },
): string | null {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= device.bedWidth && height <= device.bedHeight) return null;
  const parts: string[] = [];
  if (width > device.bedWidth) parts.push(`X span ${width.toFixed(1)} mm`);
  if (height > device.bedHeight) parts.push(`Y span ${height.toFixed(1)} mm`);
  return `Cannot frame: generated motion (${parts.join(', ')}) is larger than the ${device.bedWidth}×${device.bedHeight} mm bed. Scale the artwork down or reduce overscan.`;
}
