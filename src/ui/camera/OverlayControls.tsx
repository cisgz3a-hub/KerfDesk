// OverlayControls — the Camera panel's workspace-overlay row (ADR-107,
// LightBurn "Camera Control" parity): show/hide on canvas, a fade slider, and
// the still-vs-live source choice. "Update still" freezes the current frame
// (LightBurn's Update Overlay); "Live" returns to the continuous video.

import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { captureStreamFrame } from './frame-capture';
import { TraceFromCameraButton } from './TraceFromCameraButton';

export function OverlayControls(): JSX.Element | null {
  const alignment = useStore((s) => s.project.device.cameraAlignment);
  const stream = useCameraStore((s) => s.stream);
  const visible = useCameraStore((s) => s.overlayVisible);
  const setVisible = useCameraStore((s) => s.setOverlayVisible);
  const opacity = useCameraStore((s) => s.overlayOpacityPercent);
  const setOpacity = useCameraStore((s) => s.setOverlayOpacityPercent);
  const still = useCameraStore((s) => s.overlayStill);
  const setStill = useCameraStore((s) => s.setOverlayStill);

  // Nothing to control until an alignment exists to project.
  if (alignment === undefined) return null;

  const updateStill = async (): Promise<void> => {
    if (stream.kind !== 'live') return;
    const frame = await captureStreamFrame(stream.stream.stream);
    if (frame !== null) setStill(frame);
  };

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn"
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
          title="Show or hide the aligned camera image on the workspace canvas."
        >
          {visible ? 'Overlay on' : 'Overlay off'}
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={stream.kind !== 'live'}
          onClick={() => void updateStill()}
          title="Freeze the current camera frame as the workspace overlay."
        >
          Update still
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={still === null}
          onClick={() => setStill(null)}
          title="Use the continuous live video as the workspace overlay."
        >
          Live
        </button>
        <TraceFromCameraButton />
      </div>
      <label style={fadeStyle}>
        Fade
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          aria-label="Camera overlay opacity"
          title="How strongly the camera image shows through on the canvas."
          onChange={(e) => setOpacity(Number(e.currentTarget.value))}
          style={sliderStyle}
        />
      </label>
    </div>
  );
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
