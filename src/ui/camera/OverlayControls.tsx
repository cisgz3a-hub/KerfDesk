// OverlayControls — the everyday Camera panel once the camera is calibrated
// (ADR-107, ADR-663): refresh the bed picture or keep it live, show it on the
// canvas at the strength wanted, and the material's surface height, which the
// camera model uses to undo parallax exactly (ADR-440). Trace from camera sits
// beside Refresh; filling blanks (ADR-442) and object heights (ADR-441
// Amendment 2) open as folds. A camera on the laser head captures and stitches
// pictures instead of freezing one (ADR-449), and holds only at the Z it was
// calibrated at, which the panel says (Amendment 2). A calibration made with another
// origin corner is not drawn, and the panel says why (rolling audit 12-P2-2);
// one saved before its bed frame was recorded can be confirmed here (ADR-440
// Amendment 4).
// Camera placement stays latched after hiding the image so its status remains
// visible until the operator exits it.

import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import { headCameraZChange, isHeadCameraModel } from '../../core/camera/model/head-camera';
import { DraftNumberInput } from '../kit/DraftNumberInput';
import { Icon } from '../kit/icons';
import { useCameraStore } from '../state/camera-store';
import {
  useActiveCameraModel,
  useOwnCameraFrameNote,
  useOwnCameraModel,
} from './active-camera-model';
import { CameraFrameNotice } from './CameraFrameNotice';
import { HeadCaptureControls } from './head/HeadCaptureControls';
import { useHeadPositionOnBed } from './head/head-position';
import { headZChangedMessage, headZRule } from './head/head-z-note';
import { CameraFold } from './panel/CameraFold';
import { useCameraPlacementControls } from './use-camera-placement-controls';
import { TraceFromCameraButton } from './TraceFromCameraButton';
import { HeightAreasControl } from './heights/HeightAreasControl';
import { PiecesControl } from './pieces/PiecesControl';
import { usePieceScanStore } from './pieces/piece-scan-store';

export function OverlayControls(): JSX.Element | null {
  const model = useActiveCameraModel();
  const own = useOwnCameraModel();
  const frameNote = useOwnCameraFrameNote();
  if (model !== undefined) {
    return (
      <CalibratedOverlayControls headZRule={isHeadCameraModel(model) ? headZRule(model) : null} />
    );
  }
  if (frameNote !== null && !frameNote.usable) {
    return <CameraFrameNotice note={frameNote} style={headNoticeStyle} />;
  }
  return own !== undefined && isHeadCameraModel(own) ? <HeadCameraNotice own={own} /> : null;
}

// A head camera's picture is placed by where the head is, so it waits for
// that, and for the head's Z to be back where it was calibrated.
function HeadCameraNotice(props: { readonly own: CameraModelRecord }): JSX.Element {
  const head = useHeadPositionOnBed();
  const zChange = head === null ? null : headCameraZChange(props.own, head.z);
  return (
    <p role="status" style={headNoticeStyle}>
      {zChange === null
        ? 'This camera rides on the laser head. Connect the machine and home it, so KerfDesk knows where the head is and puts the camera picture in the right place.'
        : headZChangedMessage(zChange)}
    </p>
  );
}

function CalibratedOverlayControls(props: {
  /** What the panel says about a head camera's Z; null for a fixed camera. */
  readonly headZRule: string | null;
}): JSX.Element {
  const headCamera = props.headZRule !== null;
  const sourceState = useCameraStore((s) => s.sourceState);
  const visible = useCameraStore((s) => s.overlayVisible);
  const opacity = useCameraStore((s) => s.overlayOpacityPercent);
  const setOpacity = useCameraStore((s) => s.setOverlayOpacityPercent);
  const still = useCameraStore((s) => s.overlayStill);
  const bedPicture = useCameraStore((s) => s.bedPicture);
  const surfaceHeightMm = useCameraStore((s) => s.surfaceHeightMm);
  const setSurfaceHeightMm = useCameraStore((s) => s.setSurfaceHeightMm);
  const placement = useCameraPlacementControls(true);
  // Found pieces and height areas outlive the panel; their folds open on them.
  const piecesFound = usePieceScanStore((s) => s.scan !== null);
  const hasHeightAreas = useCameraStore((s) => s.heightAreas.length > 0);

  const sourceLive = sourceState.kind === 'live';
  return (
    <section style={sectionStyle} aria-label="Bed picture">
      <PictureActionRow
        placement={placement}
        sourceLive={sourceLive}
        hasStill={still !== null || bedPicture !== null}
        headCamera={headCamera}
      />
      {props.headZRule === null ? (
        <p style={showingStyle}>{showingNow(sourceLive, still !== null || bedPicture !== null)}</p>
      ) : (
        <>
          <HeadCaptureControls />
          <p style={showingStyle}>{props.headZRule}</p>
        </>
      )}
      <div style={rowStyle}>
        <label
          style={checkStyle}
          title="Show or hide the corrected camera picture on the workspace canvas."
        >
          <input
            type="checkbox"
            title="Show or hide the corrected camera picture on the workspace canvas."
            checked={visible}
            onChange={placement.toggleOverlay}
          />
          Show on canvas
        </label>
        <OpacityControl opacity={opacity} onChange={setOpacity} />
      </div>
      <SurfaceHeightControl heightMm={surfaceHeightMm} onChange={setSurfaceHeightMm} />
      {placement.active ? <CameraPlacementStatus placement={placement} /> : null}
      <CameraFold title="Fill blanks" hint="the design on every piece" defaultOpen={piecesFound}>
        <PiecesControl />
      </CameraFold>
      <CameraFold
        title="Raised objects"
        hint="a box or a part taller than the sheet"
        defaultOpen={hasHeightAreas}
      >
        <HeightAreasControl />
      </CameraFold>
    </section>
  );
}

type PlacementControls = ReturnType<typeof useCameraPlacementControls>;

function PictureActionRow(props: {
  readonly placement: PlacementControls;
  readonly sourceLive: boolean;
  readonly hasStill: boolean;
  readonly headCamera: boolean;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      {props.headCamera ? null : (
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={!props.sourceLive}
          onClick={() => void props.placement.updateStill()}
          title="Take a new picture of the bed and show it on the canvas, held still while you place artwork (Alt+C)."
        >
          <Icon name="refresh" size={14} /> Refresh picture
        </button>
      )}
      <button
        type="button"
        className="lf-btn"
        disabled={!props.hasStill || !props.sourceLive}
        onClick={props.placement.useLive}
        title="Show the live camera on the canvas instead of the held picture."
      >
        Live
      </button>
      <TraceFromCameraButton />
    </div>
  );
}

// Which picture the canvas holds, so Refresh and Live read as one choice.
function showingNow(sourceLive: boolean, hasStill: boolean): string {
  if (hasStill) return 'The canvas shows the refreshed picture. Live follows the camera again.';
  return sourceLive
    ? 'The canvas shows the live camera. Refresh picture holds one still.'
    : 'Start the camera to show the bed on the canvas.';
}

function SurfaceHeightControl(props: {
  readonly heightMm: number;
  readonly onChange: (heightMm: number) => void;
}): JSX.Element {
  return (
    <label style={heightStyle}>
      <span style={heightLabelStyle}>
        Material height
        <span style={heightMessageStyle}>top of the material above the bed</span>
      </span>
      <span style={heightInputStyle}>
        <DraftNumberInput
          min={0}
          max={500}
          step={0.1}
          value={props.heightMm}
          aria-label="Material surface height above bed"
          title={`The camera picture shows the bed as seen at ${props.heightMm} mm above it: set this to the top of your material so its edges line up.`}
          normalize={(value) => Math.max(0, Math.min(500, value))}
          onValueChange={props.onChange}
        />{' '}
        mm
      </span>
    </label>
  );
}

function OpacityControl(props: {
  readonly opacity: number;
  readonly onChange: (opacity: number) => void;
}): JSX.Element {
  return (
    <label style={fadeStyle}>
      Opacity
      <input
        type="range"
        min={0}
        max={100}
        value={props.opacity}
        aria-label="Camera overlay opacity"
        title="How strongly the camera picture shows through on the canvas."
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
      title="Leave camera placement mode. Start-from remains under operator control, and the completed Frame verifies exact motion."
    >
      Exit camera placement
    </button>
  );
}

function CameraPlacementStatus(props: { readonly placement: PlacementControls }): JSX.Element {
  const { placement } = props;
  return (
    <div role="status" style={placementStatusStyle(placement.positionTrusted)}>
      <strong>Camera placement active.</strong> Start-from remains under operator control; verify
      the exact placement with Frame.{' '}
      {positionTrustCopy(placement.homingEnabled, placement.positionTrusted)}
      {!placement.homingEnabled && !placement.positionTrusted ? (
        <button
          type="button"
          className="lf-btn"
          onClick={placement.confirmPosition}
          title="Confirm only after checking that the controller coordinate origin still matches the physical bed used for camera calibration. This confirmation expires after reconnect, reset, alarm, sleep, or homing."
        >
          Confirm bed coordinates
        </button>
      ) : null}
      <ExitPlacementButton onExit={placement.exit} />
    </div>
  );
}

function positionTrustCopy(homingEnabled: boolean, trusted: boolean): string {
  if (homingEnabled) {
    return trusted
      ? 'Machine position is trusted from Home.'
      : 'Home is not confirmed; watch Frame to verify the exact placement.';
  }
  return trusted
    ? 'Controller-to-bed position is confirmed for this session.'
    : 'Confirm that the controller coordinates match the bed the camera was calibrated on.';
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 8,
  borderTop: '1px solid var(--lf-border)',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};
const fadeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  minWidth: 120,
  fontSize: 12,
};
const sliderStyle: React.CSSProperties = { flex: 1 };
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const showingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-faint)',
};
const heightStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};
const heightLabelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column' };
const heightInputStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };

const heightMessageStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
const headNoticeStyle: React.CSSProperties = {
  margin: 0,
  paddingTop: 8,
  borderTop: '1px solid var(--lf-border)',
  fontSize: 12,
  color: 'var(--lf-text-faint)',
};

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
