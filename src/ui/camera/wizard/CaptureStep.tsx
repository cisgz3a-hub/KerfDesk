// CaptureStep — the wizard's live capture surface. Shows the camera with the
// detector's corner markers, auto-captures when a NEW pose is held steady
// (novelty gate), and offers a manual capture. Captures re-detect at full
// resolution inside the store, so the live (downscaled) pass is feedback only.
// Works over any ActiveCameraSource (ADR-116): USB streams detect at video
// rate; machine cameras detect at their poll cadence.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { canSolve, MIN_CALIBRATION_VIEWS } from '../../../core/camera';
import { Button } from '../../kit';
import { useCameraStore } from '../../state/camera-store';
import { CameraSourceView } from '../CameraSourceView';
import {
  captureElementFrame,
  elementFrameSize,
  liveDetectScale,
  type LiveCaptureElement,
} from '../frame-capture';
import { sourcePollIntervalMs } from '../frame-source';
import { useCameraWizardStore } from './camera-wizard-store';
import { isNovelPose } from './capture-novelty';
import { DetectionOverlay } from './DetectionOverlay';
import { useLiveDetection, type LiveDetectCapture } from './use-live-detection';

// A pose must persist this many detector ticks before auto-capture.
const AUTO_CAPTURE_STABLE_TICKS = 2;

export function CaptureStep(): JSX.Element {
  const sourceState = useCameraStore((s) => s.sourceState);
  const spec = useCameraWizardStore((s) => s.spec);
  const autoCapture = useCameraWizardStore((s) => s.autoCapture);
  const session = useCameraWizardStore((s) => s.session);
  const lastRejection = useCameraWizardStore((s) => s.lastRejection);

  const [element, setElement] = useState<LiveCaptureElement | null>(null);
  const onElement = useCallback((el: LiveCaptureElement | null) => setElement(el), []);
  const capture = useMemo<LiveDetectCapture | null>(() => {
    if (element === null) return null;
    return () => {
      const scale = liveDetectScale(elementFrameSize(element).width);
      const frame = captureElementFrame(element, scale);
      return frame === null ? null : { frame, scale };
    };
  }, [element]);

  const live = useLiveDetection(
    capture,
    spec,
    sourceState.kind === 'live',
    sourceState.kind === 'live' ? sourcePollIntervalMs(sourceState.source) : 0,
  );
  useAutoCapture(element, live, autoCapture);

  const captures = session.captures.length;
  const detectionLocked = live.corners !== null;

  if (sourceState.kind !== 'live') {
    return (
      <p style={noteStyle}>
        The camera feed is not running — start a camera in the Camera panel, then reopen this
        wizard.
      </p>
    );
  }
  return (
    <div style={columnStyle}>
      <div style={videoBoxStyle}>
        <CameraSourceView source={sourceState.source} onElement={onElement} />
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
      <CaptureControls element={element} detectionLocked={detectionLocked} />
    </div>
  );
}

function CaptureControls(props: {
  readonly element: LiveCaptureElement | null;
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
        disabled={!props.detectionLocked || props.element === null}
        onClick={() => {
          const frame = props.element === null ? null : captureElementFrame(props.element, 1);
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

// Auto-capture: a held (stable), genuinely new pose triggers a full-res grab.
// The novelty gate self-limits: right after a capture the pose is no longer
// novel, so it cannot re-fire until the board moves.
function useAutoCapture(
  element: LiveCaptureElement | null,
  live: ReturnType<typeof useLiveDetection>,
  enabled: boolean,
): void {
  const session = useCameraWizardStore((s) => s.session);
  const addCaptureFrame = useCameraWizardStore((s) => s.addCaptureFrame);
  useEffect(() => {
    if (!enabled || element === null || live.corners === null) return;
    if (live.stableTicks < AUTO_CAPTURE_STABLE_TICKS) return;
    const priors = session.captures.map((c) => c.imagePoints);
    if (!isNovelPose(live.corners, priors, live.frameWidth, live.frameHeight)) return;
    const frame = captureElementFrame(element, 1);
    if (frame !== null) addCaptureFrame(frame);
  }, [enabled, element, live, session, addCaptureFrame]);
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
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const noteStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-faint)' };
const lockedStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-accent)' };
const statusStyle: React.CSSProperties = { margin: 0, fontSize: 12 };
