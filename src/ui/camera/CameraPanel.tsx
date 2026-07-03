// CameraPanel — a minimal, non-modal preview panel for Camera Mode (ADR-105).
// This v1 slice wires the CAPTURE layer end to end so it can be tested on real
// hardware: pick a camera, start the stream, and see the live feed. It does NOT
// yet do the 4-point alignment or the warped bed overlay — those follow once the
// capture path is confirmed on a real camera. Closed state is a small launcher
// button; open state is the preview. A temporary toolbar/command entry is a
// follow-up (kept off the command registry to stay a small, reviewable slice).

import { useEffect, useRef } from 'react';
import { usePlatform } from '../app';
import {
  type CameraStreamState,
  type NetworkCameraState,
  useCameraStore,
} from '../state/camera-store';
import type { CameraAdapter } from '../../platform/types';
import { NetworkCameraView } from './NetworkCameraView';

export function CameraPanel(): JSX.Element {
  const open = useCameraStore((s) => s.panelOpen);
  const toggle = useCameraStore((s) => s.togglePanel);
  if (!open) {
    return (
      <button
        type="button"
        className="lf-btn"
        style={launcherStyle}
        onClick={toggle}
        title="Open the camera preview (ADR-105)"
      >
        Camera
      </button>
    );
  }
  return <CameraPanelOpen />;
}

function CameraPanelOpen(): JSX.Element {
  const close = useCameraStore((s) => s.closePanel);
  const camera = usePlatform().camera;
  const isSupported = useCameraStore((s) => s.isSupported);
  const detectSupport = useCameraStore((s) => s.detectSupport);
  const refreshCameras = useCameraStore((s) => s.refreshCameras);
  const stopStream = useCameraStore((s) => s.stopStream);
  const networkCamera = useCameraStore((s) => s.networkCamera);
  const detectNetworkCamera = useCameraStore((s) => s.detectNetworkCamera);

  useEffect(() => {
    detectSupport(camera);
    void refreshCameras(camera);
    return () => stopStream();
  }, [camera, detectSupport, refreshCameras, stopStream]);

  return (
    <div role="dialog" aria-label="Camera preview" style={panelStyle}>
      <div style={headerStyle}>
        <strong>Camera preview</strong>
        <button
          type="button"
          className="lf-btn"
          onClick={close}
          aria-label="Close camera preview"
          title="Close the camera preview."
        >
          ×
        </button>
      </div>
      <NetworkCameraSection
        state={networkCamera}
        onDetect={() => void detectNetworkCamera(camera)}
      />
      {isSupported ? (
        <UsbCameraSection camera={camera} />
      ) : (
        <p style={noteStyle}>
          A USB webcam needs a Chromium browser over https/localhost — not available here. The
          machine camera above does not need it.
        </p>
      )}
    </div>
  );
}

// The UVC/getUserMedia half of the panel: device picker, live feed, and the
// start/stop control. Split from CameraPanelOpen to respect the function size
// limit and because it owns a distinct concern (browser webcams, not the
// machine-integrated network camera above it).
function UsbCameraSection(props: { readonly camera: CameraAdapter | undefined }): JSX.Element {
  const { camera } = props;
  const cameras = useCameraStore((s) => s.cameras);
  const selectedDeviceId = useCameraStore((s) => s.selectedDeviceId);
  const stream = useCameraStore((s) => s.stream);
  const selectCamera = useCameraStore((s) => s.selectCamera);
  const startStream = useCameraStore((s) => s.startStream);
  const stopStream = useCameraStore((s) => s.stopStream);

  return (
    <>
      {cameras.length > 1 ? (
        <select
          aria-label="Camera device"
          title="Choose which connected camera to preview."
          value={selectedDeviceId ?? ''}
          onChange={(e) => {
            selectCamera(e.currentTarget.value);
            // Switch the live feed immediately to the picked camera.
            if (stream.kind === 'live' || stream.kind === 'starting') {
              void startStream(camera);
            }
          }}
          style={selectStyle}
        >
          {cameras.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label === '' ? `Camera ${index + 1}` : device.label}
            </option>
          ))}
        </select>
      ) : null}
      {stream.kind === 'live' || stream.kind === 'starting' ? <CameraFeed stream={stream} /> : null}
      <div style={rowStyle}>
        {stream.kind === 'live' ? (
          <button
            type="button"
            className="lf-btn"
            onClick={stopStream}
            title="Stop the live camera feed."
          >
            Stop camera
          </button>
        ) : (
          <button
            type="button"
            className="lf-btn"
            disabled={stream.kind === 'starting'}
            onClick={() => void startStream(camera)}
            title="Start the live camera feed."
          >
            {stream.kind === 'starting' ? 'Starting…' : 'Start camera'}
          </button>
        )}
      </div>
      <StreamNote stream={stream} />
    </>
  );
}

function CameraFeed(props: { readonly stream: CameraStreamState }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const live = props.stream.kind === 'live' ? props.stream.stream.stream : null;
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return undefined;
    video.srcObject = live;
    if (live !== null) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [live]);
  return <video ref={videoRef} autoPlay muted playsInline style={feedStyle} />;
}

function NetworkCameraSection(props: {
  readonly state: NetworkCameraState;
  readonly onDetect: () => void;
}): JSX.Element {
  const { state } = props;
  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn"
          disabled={state.kind === 'detecting'}
          onClick={props.onDetect}
          title="Detect the camera on the connected laser machine."
        >
          {state.kind === 'detecting' ? 'Detecting…' : 'Detect machine camera'}
        </button>
      </div>
      {state.kind === 'found' ? <NetworkCameraView frameUrl={state.frameUrl} /> : null}
      {state.kind === 'not-found' ? (
        <p style={noteStyle}>
          No machine camera found. Connect the laser by USB, power it on, then retry.
        </p>
      ) : null}
    </div>
  );
}

function StreamNote(props: { readonly stream: CameraStreamState }): JSX.Element | null {
  const { stream } = props;
  if (stream.kind === 'denied') {
    return <p style={errStyle}>Permission denied. Allow camera access and press Start again.</p>;
  }
  if (stream.kind === 'error') {
    return <p style={errStyle}>{stream.message}</p>;
  }
  return null;
}

const launcherStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  zIndex: 5,
};
const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  zIndex: 5,
  width: 320,
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const selectStyle: React.CSSProperties = { width: '100%' };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8 };
const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingBottom: 8,
  borderBottom: '1px solid var(--lf-border)',
};
const feedStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '4 / 3',
  background: 'var(--lf-bg-2)',
  borderRadius: 4,
  objectFit: 'contain',
};
const noteStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', margin: 0 };
const errStyle: React.CSSProperties = { color: 'var(--lf-danger)', margin: 0 };
