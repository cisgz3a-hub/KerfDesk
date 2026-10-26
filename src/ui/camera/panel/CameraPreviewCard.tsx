// CameraPreviewCard — the top of the everyday Camera panel (ADR-663): what
// the camera sees, which camera it is and whether it runs, with one button to
// start the camera this computer would pick: the laser's own camera when the
// bridge found one, otherwise the chosen USB camera. Every other camera is
// chosen in Camera settings, so the panel never lists sources it does not use.

import type { CSSProperties } from 'react';
import type { CameraAdapter } from '../../../platform/types';
import { usePlatform } from '../../app';
import { Icon } from '../../kit/icons';
import { useCameraStore, type CameraSourceState } from '../../state/camera-store';
import { CameraSourceView } from '../CameraSourceView';
import { NetworkCameraView } from '../NetworkCameraView';
import { cameraSourceName, MACHINE_CAMERA_NAME } from './camera-names';

export function CameraPreviewCard(props: { readonly onChooseCamera: () => void }): JSX.Element {
  const camera = usePlatform().camera;
  const sourceState = useCameraStore((s) => s.sourceState);
  const machineCamera = useCameraStore((s) => s.machineCamera);
  const cameras = useCameraStore((s) => s.cameras);
  const selectedDeviceId = useCameraStore((s) => s.selectedDeviceId);
  const usbMuted = useCameraStore((s) => s.usbAvailability.kind === 'muted');
  const stopSource = useCameraStore((s) => s.stopSource);

  if (sourceState.kind === 'live') {
    const name = cameraSourceName(sourceState.source, { cameras, selectedDeviceId, machineCamera });
    return (
      <div style={cardStyle} aria-label="Camera picture">
        <CameraSourceView source={sourceState.source} />
        <div style={statusRowStyle}>
          <StatusDot tone="live" />
          <strong style={nameStyle}>{name}</strong>
          <button
            type="button"
            className="lf-btn"
            onClick={stopSource}
            title="Stop the camera. Its calibration stays saved."
          >
            Stop
          </button>
        </div>
        {usbMuted ? (
          <p role="status" style={warnStyle}>
            The camera is not sending pictures for the moment. It carries on when they come back.
          </p>
        ) : null}
      </div>
    );
  }
  if (machineCamera.kind === 'found' && sourceState.kind !== 'starting') {
    return (
      <div style={cardStyle} aria-label="Camera picture">
        <NetworkCameraView frameUrl={machineCamera.proxyFrameUrl} />
        <div style={statusRowStyle}>
          <StatusDot tone="found" />
          <strong style={nameStyle}>{MACHINE_CAMERA_NAME}</strong>
          <StartButton label="Use this camera" />
        </div>
        <SourceProblem sourceState={sourceState} />
      </div>
    );
  }
  return (
    <div style={cardStyle} aria-label="Camera picture">
      <div style={placeholderStyle}>
        <Icon name="camera" size={28} />
        <span>{placeholderText(sourceState, machineCamera.kind === 'detecting')}</span>
      </div>
      <div style={statusRowStyle}>
        {canStartUsb(camera) ? <StartButton label="Start camera" /> : null}
        <button
          type="button"
          className="lf-btn"
          onClick={props.onChooseCamera}
          title="Pick the camera: the laser's own, a USB camera, a network camera or a phone."
        >
          Choose camera…
        </button>
      </div>
      <SourceProblem sourceState={sourceState} />
    </div>
  );
}

// The laser's camera when the bridge found it, else the chosen USB camera.
function StartButton(props: { readonly label: string }): JSX.Element {
  const camera = usePlatform().camera;
  const starting = useCameraStore((s) => s.sourceState.kind === 'starting');
  const machineFound = useCameraStore((s) => s.machineCamera.kind === 'found');
  const activateMachineCamera = useCameraStore((s) => s.activateMachineCamera);
  const startUsbSource = useCameraStore((s) => s.startUsbSource);
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      disabled={starting}
      onClick={() => (machineFound ? activateMachineCamera() : void startUsbSource(camera))}
      title={
        machineFound
          ? "Use the laser's built-in camera for the canvas picture, calibration and trace."
          : 'Start the USB camera chosen in Camera settings.'
      }
    >
      {starting ? 'Starting…' : props.label}
    </button>
  );
}

function canStartUsb(camera: CameraAdapter | undefined): boolean {
  return camera?.isSupported() ?? false;
}

function placeholderText(sourceState: CameraSourceState, detecting: boolean): string {
  if (sourceState.kind === 'starting') return 'Starting the camera…';
  if (detecting) return "Looking for the laser's camera…";
  return 'Camera off';
}

function SourceProblem(props: { readonly sourceState: CameraSourceState }): JSX.Element | null {
  const { sourceState } = props;
  if (sourceState.kind === 'denied') {
    return (
      <p style={errStyle}>
        Camera access was blocked. Allow it and press Start again. On Windows, also open Settings,
        Privacy &amp; security, Camera, and let desktop apps use the camera.
      </p>
    );
  }
  if (sourceState.kind === 'error') return <p style={errStyle}>{sourceState.message}</p>;
  return null;
}

function StatusDot(props: { readonly tone: 'live' | 'found' }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        ...dotStyle,
        background: props.tone === 'live' ? 'var(--lf-success)' : 'var(--lf-text-faint)',
      }}
    />
  );
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 6,
  borderRadius: 6,
  background: 'var(--lf-bg-1)',
  border: '1px solid var(--lf-border)',
};
const statusRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const nameStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const placeholderStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  aspectRatio: '4 / 3',
  borderRadius: 4,
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text-faint)',
};
const dotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flex: 'none',
};
const errStyle: CSSProperties = { margin: 0, color: 'var(--lf-danger-fg)' };
const warnStyle: CSSProperties = { margin: 0, color: 'var(--lf-warning-fg)' };
