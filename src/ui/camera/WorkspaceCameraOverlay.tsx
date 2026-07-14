// WorkspaceCameraOverlay — the persisted camera→bed alignment projected onto
// the workspace canvas (ADR-107: the overlay that finally lets the operator
// place artwork over the REAL material). Mounts as a canvas-area sibling
// (Workspace stays untouched); it measures its own box — which is the canvas's
// box — and recomputes the same fit-to-bed view the canvas renderer uses, so
// the warped frame tracks zoom and pan exactly. Sources, in priority order:
// a captured still (LightBurn's Update Overlay model), else the live video.

import { useMemo } from 'react';
import {
  scaleAlignmentHomographyToFrame,
  type CameraAlignment,
  type CameraCalibration,
  type RgbaImage,
} from '../../core/camera';
import type { CameraCaptureBinding } from '../../core/camera/camera-capture-binding';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useUiStore } from '../state/ui-store';
import type { ViewTransform } from '../workspace/view-transform';
import { computeView } from '../workspace/view-transform';
import { CameraOverlay } from './CameraOverlay';
import { overlayMatrix3d } from './camera-overlay-transform';
import { resolveWorkspaceOverlay, type WorkspaceOverlayPlan } from './workspace-overlay-plan';
import { cameraBindingIssue } from './camera-binding-guard';
import { cameraCaptureBindingForFrame } from './frame-source';
import { cameraSurfaceHeightIssue, resolveCameraSurfaceHeight } from './camera-surface-height';
import { StillCameraOverlay } from './StillCameraOverlay';
import { useElementSize, type ElementSize } from './use-element-size';

export function WorkspaceCameraOverlay(): JSX.Element | null {
  const alignment = useStore((s) => s.project.device.cameraAlignment);
  const calibration = useStore((s) => s.project.device.cameraCalibration);
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const visible = useCameraStore((s) => s.overlayVisible);
  const opacityPercent = useCameraStore((s) => s.overlayOpacityPercent);
  const still = useCameraStore((s) => s.overlayStill);
  const stillCapture = useCameraStore((s) => s.overlayStillCapture);
  const surfaceHeightMm = useCameraStore((s) => s.surfaceHeightMm);
  const sourceState = useCameraStore((s) => s.sourceState);
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const panX = useUiStore((s) => s.panX);
  const panY = useUiStore((s) => s.panY);
  const [box, boxRef] = useElementSize();

  // Live overlay needs a MediaStream (USB); machine sources overlay via the
  // captured still (LightBurn's Update Overlay model).
  const liveStream = liveUsbStream(sourceState);
  // Decide (and rectify the still, if the alignment is rectified) once per
  // source/alignment change, not on every zoom/pan render (R2).
  const plan = useMemo(
    () => optionalWorkspacePlan(alignment, calibration, still, liveStream !== null),
    [alignment, calibration, still, liveStream],
  );

  const currentCapture = currentOverlayCapture(sourceState, still, stillCapture, alignment);
  const surface = optionalCameraSurface(alignment, calibration, surfaceHeightMm);
  const geometryIssue = surface === null ? null : cameraSurfaceHeightIssue(surface);
  const bindingIssue = overlayBindingIssue(alignment, currentCapture) ?? geometryIssue;

  if (alignment === undefined) return null;
  if (!visible) return null;
  if (plan === null || plan.kind === 'none') return null;

  const view = overlayView(box, bedWidth, bedHeight, zoomFactor, panX, panY);
  return (
    <div
      ref={boxRef}
      style={boxStyle}
      aria-hidden={bindingIssue === null && plan.kind !== 'basis-mismatch'}
    >
      {renderWorkspaceOverlayContent({
        plan,
        view,
        liveStream,
        alignment,
        opacityPercent,
        currentCapture,
        bindingIssue,
        surface,
      })}
    </div>
  );
}

function liveUsbStream(
  sourceState: ReturnType<typeof useCameraStore.getState>['sourceState'],
): MediaStream | null {
  if (sourceState.kind !== 'live' || sourceState.source.kind !== 'usb') return null;
  return sourceState.source.stream.stream;
}

function optionalWorkspacePlan(
  alignment: CameraAlignment | undefined,
  calibration: CameraCalibration | undefined,
  still: RgbaImage | null,
  hasLiveStream: boolean,
): WorkspaceOverlayPlan | null {
  if (alignment === undefined) return null;
  return resolveWorkspaceOverlay({ still, hasLiveStream, alignment, calibration });
}

function optionalCameraSurface(
  alignment: CameraAlignment | undefined,
  calibration: CameraCalibration | undefined,
  surfaceHeightMm: number,
): ReturnType<typeof resolveCameraSurfaceHeight> | null {
  return alignment === undefined
    ? null
    : resolveCameraSurfaceHeight(alignment, calibration, surfaceHeightMm);
}

function overlayView(
  box: ElementSize | null,
  bedWidth: number,
  bedHeight: number,
  zoomFactor: number,
  panX: number,
  panY: number,
): ViewTransform | null {
  if (box === null) return null;
  return computeView(box.width, box.height, bedWidth, bedHeight, { zoomFactor, panX, panY });
}

function renderWorkspaceOverlayContent(args: {
  readonly plan: WorkspaceOverlayPlan;
  readonly view: ViewTransform | null;
  readonly liveStream: MediaStream | null;
  readonly alignment: CameraAlignment;
  readonly opacityPercent: number;
  readonly currentCapture: CameraCaptureBinding | null;
  readonly bindingIssue: string | null;
  readonly surface: ReturnType<typeof resolveCameraSurfaceHeight> | null;
}): JSX.Element | null {
  if (args.bindingIssue !== null || args.surface?.ok !== true) {
    return (
      <SetupMismatchNotice
        message={args.bindingIssue ?? 'Camera surface geometry is unavailable.'}
      />
    );
  }
  return renderOverlay(args.plan, {
    view: args.view,
    liveStream: args.liveStream,
    alignment: { ...args.alignment, homography: args.surface.homography },
    opacityPercent: args.opacityPercent,
    currentCapture: args.currentCapture,
  });
}

function currentOverlayCapture(
  sourceState: ReturnType<typeof useCameraStore.getState>['sourceState'],
  still: RgbaImage | null,
  stillCapture: CameraCaptureBinding | null,
  alignment: CameraAlignment | undefined,
): CameraCaptureBinding | null {
  if (alignment === undefined) return null;
  if (stillCapture !== null) return stillCapture;
  if (sourceState.kind !== 'live') return null;
  const width = still?.width ?? alignment.frameWidth;
  const height = still?.height ?? alignment.frameHeight;
  return cameraCaptureBindingForFrame(sourceState.source, width, height);
}

function overlayBindingIssue(
  alignment: CameraAlignment | undefined,
  current: CameraCaptureBinding | null,
): string | null {
  if (alignment === undefined || current === null) return null;
  return cameraBindingIssue('bed alignment', alignment.capture, current);
}

function renderOverlay(
  plan: WorkspaceOverlayPlan,
  ctx: {
    readonly view: ViewTransform | null;
    readonly liveStream: MediaStream | null;
    readonly alignment: CameraAlignment;
    readonly opacityPercent: number;
    readonly currentCapture: CameraCaptureBinding | null;
  },
): JSX.Element | null {
  // A rectified alignment we cannot de-fisheye for display (no calibration, or a
  // live video): show a hint instead of a mis-registered overlay (R2).
  if (plan.kind === 'basis-mismatch') return <BasisMismatchNotice />;
  if (ctx.view === null) return null;
  if (plan.kind === 'still') {
    return (
      <StillCameraOverlay
        still={plan.frame}
        // Rescale to the still's own resolution (it may differ from the
        // calibration frame), matching the Trace path (Codex audit P2).
        matrix={overlayMatrix3d(
          scaleAlignmentHomographyToFrame(ctx.alignment, plan.frame.width, plan.frame.height),
          ctx.view,
        )}
        opacityPercent={ctx.opacityPercent}
      />
    );
  }
  if (plan.kind === 'live' && ctx.liveStream !== null) {
    return (
      <CameraOverlay
        stream={ctx.liveStream}
        alignment={ctx.alignment}
        view={ctx.view}
        opacityPercent={ctx.opacityPercent}
        captureBinding={ctx.currentCapture}
      />
    );
  }
  return null;
}

// A calibrated (rectified) alignment can only be shown correctly on a captured,
// lens-corrected still — not on a raw live frame. NOT perceptually verified; the
// exact wording/placement is a maintainer UX call.
function BasisMismatchNotice(): JSX.Element {
  return (
    <div role="status" style={noticeStyle}>
      Aligned camera overlay needs a captured still. Use “Update overlay”.
    </div>
  );
}

function SetupMismatchNotice(props: { readonly message: string }): JSX.Element {
  return (
    <div role="status" style={noticeStyle}>
      {props.message}
    </div>
  );
}

// Under the floating panels (zIndex 5) and above the canvas; pointer-events
// none so all canvas interaction passes through untouched.
const boxStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: 1,
};

const noticeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 'var(--lf-text-sm)',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-warning-fg)',
  pointerEvents: 'none',
};
