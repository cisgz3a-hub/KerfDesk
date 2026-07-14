// OverlayControls â€” the Camera panel's workspace-overlay row (ADR-107,
// LightBurn "Camera Control" parity): show/hide on canvas, a fade slider, and
// the still-vs-live source choice. Camera placement stays latched after hiding
// the image so relative origins cannot silently shift camera-positioned work.

import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import type { CameraAlignment } from '../../core/camera';
import { useCameraPlacementControls } from './use-camera-placement-controls';
import { TraceFromCameraButton } from './TraceFromCameraButton';
import { cameraSurfaceHeightIssue, resolveCameraSurfaceHeight } from './camera-surface-height';

export function OverlayControls(): JSX.Element | null {
  const alignment = useStore((s) => s.project.device.cameraAlignment);
  return alignment === undefined ? null : <AlignedOverlayControls alignment={alignment} />;
}

function AlignedOverlayControls(props: { readonly alignment: CameraAlignment }): JSX.Element {
  const calibration = useStore((s) => s.project.device.cameraCalibration);
  const sourceState = useCameraStore((s) => s.sourceState);
  const visible = useCameraStore((s) => s.overlayVisible);
  const opacity = useCameraStore((s) => s.overlayOpacityPercent);
  const setOpacity = useCameraStore((s) => s.setOverlayOpacityPercent);
  const still = useCameraStore((s) => s.overlayStill);
  const surfaceHeightMm = useCameraStore((s) => s.surfaceHeightMm);
  const setSurfaceHeightMm = useCameraStore((s) => s.setSurfaceHeightMm);
  const surface = resolveCameraSurfaceHeight(props.alignment, calibration, surfaceHeightMm);
  const surfaceIssue = cameraSurfaceHeightIssue(surface);
  const placement = useCameraPlacementControls(surfaceIssue === null);

  const liveOverlayAvailable = sourceState.kind === 'live' && sourceState.source.kind === 'usb';
  return (
    <div style={sectionStyle}>
      <OverlayActionRow
        placement={placement}
        visible={visible}
        sourceLive={sourceState.kind === 'live'}
        liveOverlayAvailable={liveOverlayAvailable}
        hasStill={still !== null}
      />
      {placement.active ? <CameraPlacementStatus placement={placement} /> : null}
      <SurfaceHeightControl
        alignment={props.alignment}
        heightMm={surfaceHeightMm}
        issue={surfaceIssue}
        adjusted={surface.ok && surface.adjusted}
        onChange={setSurfaceHeightMm}
      />
      <FadeControl opacity={opacity} onChange={setOpacity} />
    </div>
  );
}

type PlacementControls = ReturnType<typeof useCameraPlacementControls>;

function OverlayActionRow(props: {
  readonly placement: PlacementControls;
  readonly visible: boolean;
  readonly sourceLive: boolean;
  readonly liveOverlayAvailable: boolean;
  readonly hasStill: boolean;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <button
        type="button"
        className="lf-btn"
        aria-pressed={props.visible}
        onClick={props.placement.toggleOverlay}
        title="Show or hide the aligned camera image on the workspace canvas."
      >
        {props.visible ? 'Overlay on' : 'Overlay off'}
      </button>
      <button
        type="button"
        className="lf-btn"
        disabled={!props.sourceLive}
        onClick={() => void props.placement.updateStill()}
        title="Freeze the current camera frame as the workspace overlay."
      >
        Update still
      </button>
      <button
        type="button"
        className="lf-btn"
        disabled={!props.hasStill || !props.liveOverlayAvailable}
        onClick={props.placement.useLive}
        title="Use the continuous live video as the workspace overlay (USB cameras)."
      >
        Live
      </button>
      <TraceFromCameraButton />
      {props.placement.active ? <ExitPlacementButton onExit={props.placement.exit} /> : null}
    </div>
  );
}

function SurfaceHeightControl(props: {
  readonly alignment: CameraAlignment;
  readonly heightMm: number;
  readonly issue: string | null;
  readonly adjusted: boolean;
  readonly onChange: (heightMm: number) => void;
}): JSX.Element {
  const status = props.adjusted
    ? `Perspective corrected from ${props.alignment.planeHeightMm ?? 0} mm to ${props.heightMm} mm.`
    : `Using the ${props.heightMm} mm alignment plane.`;
  const verification =
    props.alignment.verificationErrorMm === undefined
      ? ''
      : ` Alignment check: ${props.alignment.verificationErrorMm.toFixed(2)} mm.`;
  return (
    <>
      <label style={heightStyle}>
        Material surface height
        <span style={heightInputStyle}>
          <input
            type="number"
            min={0}
            max={500}
            step={0.1}
            value={props.heightMm}
            aria-label="Material surface height above bed"
            title="Height of the material's top surface above the machine bed. KerfDesk compensates camera perspective to this plane."
            onChange={(event) => props.onChange(Number(event.currentTarget.value))}
          />{' '}
          mm
        </span>
      </label>
      <div role={props.issue === null ? 'status' : 'alert'} style={heightMessageStyle(props.issue)}>
        {props.issue ?? `${status}${verification}`}
      </div>
    </>
  );
}

function FadeControl(props: {
  readonly opacity: number;
  readonly onChange: (opacity: number) => void;
}): JSX.Element {
  return (
    <label style={fadeStyle}>
      Fade
      <input
        type="range"
        min={0}
        max={100}
        value={props.opacity}
        aria-label="Camera overlay opacity"
        title="How strongly the camera image shows through on the canvas."
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
        style={sliderStyle}
      />
    </label>
  );
}

function ExitPlacementButton(props: { readonly onExit: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn"
      onClick={props.onExit}
      title="Leave camera placement mode. Absolute Coordinates remains selected, but the camera-specific Start and Frame gate is removed."
    >
      Exit camera placement
    </button>
  );
}

function CameraPlacementStatus(props: { readonly placement: PlacementControls }): JSX.Element {
  const { placement } = props;
  return (
    <div role="status" style={placementStatusStyle(placement.positionTrusted)}>
      <strong>Camera placement active.</strong> Absolute Coordinates is locked.{' '}
      {positionTrustCopy(placement.homingEnabled, placement.positionTrusted)}
      {!placement.homingEnabled && !placement.positionTrusted ? (
        <button
          type="button"
          className="lf-btn"
          onClick={placement.confirmPosition}
          title="Confirm only after checking that the controller coordinate origin still matches the physical bed used for camera alignment. This confirmation expires after reconnect, reset, alarm, sleep, or homing."
        >
          Confirm bed coordinates
        </button>
      ) : null}
    </div>
  );
}

function positionTrustCopy(homingEnabled: boolean, trusted: boolean): string {
  if (homingEnabled) {
    return trusted
      ? 'Machine position is trusted from Home.'
      : 'Home the machine before Frame or Start.';
  }
  return trusted
    ? 'Controller-to-bed position is confirmed for this session.'
    : 'Confirm that the controller coordinates match the camera-aligned bed.';
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 8,
  borderTop: '1px solid var(--lf-border)',
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const fadeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const sliderStyle: React.CSSProperties = { flex: 1 };
const heightStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const heightInputStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };

function heightMessageStyle(issue: string | null): React.CSSProperties {
  return {
    fontSize: 12,
    color: issue === null ? 'var(--lf-success-fg)' : 'var(--lf-warning-fg)',
  };
}

function placementStatusStyle(trusted: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 12,
    background: 'var(--lf-bg-1)',
    border: `1px solid ${trusted ? 'var(--lf-success)' : 'var(--lf-warning)'}`,
    color: trusted ? 'var(--lf-success-fg)' : 'var(--lf-warning-fg)',
  };
}
