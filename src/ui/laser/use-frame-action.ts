import type { DeviceProfile } from '../../core/devices';
import type { MotionBoundsOffset } from '../../core/invariants';
import { filterSceneForOutputScope } from '../../core/scene';
import {
  computeFrameBounds,
  computeJobBounds,
  computeJobMotionBounds,
  describeFramePreflightFailure,
  frameBoundsSignature,
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
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    void runFrameAction({
      frame,
      statusReport,
      workOriginActive,
      wcoCache,
      homingState,
      trustedPositionEpoch,
      pushToast,
    });
  };
}

async function runFrameAction({
  frame,
  statusReport,
  workOriginActive,
  wcoCache,
  homingState,
  trustedPositionEpoch,
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
}): Promise<void> {
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
  });
  if (!placement.ok) {
    pushToast(placement.messages[0] ?? 'Job origin cannot be resolved.', 'error');
    return;
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
      dispatchFrameIfSafe(frame, pushToast, fallbackBounds, fallbackBounds, placement, project);
      return;
    }
    pushToast(
      prepared.preflight.issues[0]?.message ?? 'Raster job is too large to frame.',
      'error',
    );
    return;
  }
  const bounds = computeJobBounds(prepared.job, project.device);
  if (bounds === null) {
    pushToast('Nothing to frame — enable Output on at least one layer.', 'warning');
    return;
  }
  const motionBounds = computeJobMotionBounds(prepared.job, project.device) ?? bounds;
  dispatchFrameIfSafe(frame, pushToast, bounds, motionBounds, placement, project);
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

function dispatchFrameIfSafe(
  frame: (bounds: JobBounds, feed: number) => Promise<void>,
  pushToast: (message: string, variant: 'error') => void,
  bounds: JobBounds,
  motionBounds: JobBounds,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
  project: ReturnType<typeof useStore.getState>['project'],
): void {
  const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);
  const motionIssue = describeFrameMotionPreflightIssue(
    motionBounds,
    motionOffset,
    placement.jobOrigin !== undefined,
    project.device,
  );
  if (motionIssue !== null) {
    pushToast(motionIssue, 'error');
    return;
  }
  const feed = project.device.framingFeedMmPerMin;
  const isVerifiedOrigin = placement.jobOrigin?.startFrom === 'verified-origin';
  void frame(bounds, feed)
    .then(() => {
      if (!isVerifiedOrigin) return;
      const laser = useLaserStore.getState();
      laser.markFrameVerified({
        boundsSignature: frameBoundsSignature(bounds),
        wco: laser.wcoCache,
        workOriginActive: laser.workOriginActive,
      });
    })
    .catch(() => undefined);
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
