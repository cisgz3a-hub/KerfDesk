// CaptureStep — the wizard's live capture surface. Shows the camera with the
// detector's corner markers, auto-captures when a NEW pose is held steady
// (novelty gate), and offers a manual capture. Captures re-detect at full
// resolution inside the store, so the live (downscaled) pass is feedback only.

import { useEffect, useState } from 'react';
import { canSolve, MIN_CALIBRATION_VIEWS } from '../../../core/camera';
import { Button } from '../../kit';
import { useCameraStore } from '../../state/camera-store';
import { captureVideoFrame } from '../frame-capture';
import { useCameraWizardStore } from './camera-wizard-store';
import { isNovelPose } from './capture-novelty';
import { DetectionOverlay } from './DetectionOverlay';
import { useLiveDetection } from './use-live-detection';

// A pose must persist this many detector ticks (~0.5 s) before auto-capture.
const AUTO_CAPTURE_STABLE_TICKS = 2;

export function CaptureStep(): JSX.Element {
  const stream = useCameraStore((s) => s.stream);
  const spec = useCameraWizardStore((s) => s.spec);
  const autoCapture = useCameraWizardStore((s) => s.autoCapture);
  const session = useCameraWizardStore((s) => s.session);
  const lastRejection = useCameraWizardStore((s) => s.lastRejection);

  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const live = useLiveDetection(video, spec, stream.kind === 'live');
  useAttachStream(video, stream.kind === 'live' ? stream.stream.stream : null);
  useAutoCapture(video, live, autoCapture);

  const captures = session.captures.length;
  const detectionLocked = live.corners !== null;

  if (stream.kind !== 'live') {
    return (
      <p style={noteStyle}>
        The camera feed is not running — start the camera in the Camera panel, then reopen this
        wizard.
      </p>
    );
  }
  return (
    <div style={columnStyle}>
      <div style={videoBoxStyle}>
        <video ref={setVideo} autoPlay muted playsInline style={videoStyle} />
        {live.corners !== null ? (
          <DetectionOverlay
            corners={live.corners}
            frameWidth={live.frameWidth}
            frameHeight={live.frameHeight}
          />
        ) : null}
      </div>
      <p style={detectionLocked ? lockedStyle : noteStyle}>
        {detectionLocked
          ? 'Board detected — hold it steady to capture, then move to a new angle.'
          : 'Show the whole board to the camera. Tilt it toward each corner of the view.'}
      </p>
      <p style={statusStyle}>
        Captures: {captures} / {MIN_CALIBRATION_VIEWS} minimum
        {lastRejection === 'not-found'
          ? ' — last capture had no full board; retaken poses help.'
          : ''}
        {lastRejection === 'resolution-changed'
          ? ' — the camera resolution changed; reset and recapture.'
          : ''}
      </p>
      <CaptureControls video={video} detectionLocked={detectionLocked} />
    </div>
  );
}

function CaptureControls(props: {
  readonly video: HTMLVideoElement | null;
  readonly detectionLocked: boolean;
}): JSX.Element {
  const autoCapture = useCameraWizardStore((s) => s.autoCapture);
  const setAutoCapture = useCameraWizardStore((s) => s.setAutoCapture);
  const session = useCameraWizardStore((s) => s.session);
  const addCaptureFrame = useCameraWizardStore((s) => s.addCaptureFrame);
  const resetSession = useCameraWizardStore((s) => s.resetSession);
  const beginSolve = useCameraWizardStore((s) => s.beginSolve);
  return (
    <div style={rowStyle}>
      <Button
        pressed={autoCapture}
        onClick={() => setAutoCapture(!autoCapture)}
        title="Automatically capture whenever a new board pose is held steady."
      >
        Auto-capture
      </Button>
      <Button
        disabled={!props.detectionLocked || props.video === null}
        onClick={() => {
          const frame = props.video === null ? null : captureVideoFrame(props.video, 1);
          if (frame !== null) addCaptureFrame(frame);
        }}
        title="Capture the current board pose now."
      >
        Capture now
      </Button>
      <Button
        variant="ghost"
        disabled={session.captures.length === 0}
        onClick={resetSession}
        title="Discard all captures and start over."
      >
        Reset
      </Button>
      <Button
        variant="primary"
        disabled={!canSolve(session)}
        onClick={beginSolve}
        title="Solve the lens model from the captured poses."
      >
        Solve calibration
      </Button>
    </div>
  );
}

function useAttachStream(video: HTMLVideoElement | null, media: MediaStream | null): void {
  useEffect(() => {
    if (video === null) return undefined;
    video.srcObject = media;
    if (media !== null) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [video, media]);
}

// Auto-capture: a held (stable), genuinely new pose triggers a full-res grab.
// The novelty gate self-limits: right after a capture the pose is no longer
// novel, so it cannot re-fire until the board moves.
function useAutoCapture(
  video: HTMLVideoElement | null,
  live: ReturnType<typeof useLiveDetection>,
  enabled: boolean,
): void {
  const session = useCameraWizardStore((s) => s.session);
  const addCaptureFrame = useCameraWizardStore((s) => s.addCaptureFrame);
  useEffect(() => {
    if (!enabled || video === null || live.corners === null) return;
    if (live.stableTicks < AUTO_CAPTURE_STABLE_TICKS) return;
    const priors = session.captures.map((c) => c.imagePoints);
    if (!isNovelPose(live.corners, priors, live.frameWidth, live.frameHeight)) return;
    const frame = captureVideoFrame(video, 1);
    if (frame !== null) addCaptureFrame(frame);
  }, [enabled, video, live, session, addCaptureFrame]);
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const videoBoxStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '4 / 3',
  background: 'var(--lf-bg-2)',
  borderRadius: 4,
  overflow: 'hidden',
};
const videoStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const noteStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-faint)' };
const lockedStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-accent)' };
const statusStyle: React.CSSProperties = { margin: 0, fontSize: 12 };
