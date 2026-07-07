// CameraPanel — a non-modal preview panel for Camera Mode (ADR-107/116): pick
// a camera (machine-integrated via the bridge, or USB), start it as the
// active source, calibrate the lens, align to the bed, and control the
// workspace overlay. The panel is opened from the top toolbar / Tools menu
// via the `tools.camera` command (like the registration jig); it renders
// nothing until opened, and its own × button closes it.

import { useEffect } from 'react';
import { usePlatform } from '../app';
import {
  type CameraSourceState,
  type MachineCameraState,
  useCameraStore,
} from '../state/camera-store';
import type { CameraAdapter } from '../../platform/types';
import { AutoAlignControls } from './AutoAlignControls';
import { CameraSourceView } from './CameraSourceView';
import { NetworkCameraView } from './NetworkCameraView';
import { OverlayControls } from './OverlayControls';
import { CameraCalibrationWizard } from './wizard/CameraCalibrationWizard';
import { useCameraWizardStore } from './wizard/camera-wizard-store';

export function CameraPanel(): JSX.Element | null {
  const open = useCameraStore((s) => s.panelOpen);
  return open ? <CameraPanelOpen /> : null;
}

function CameraPanelOpen(): JSX.Element {
  const close = useCameraStore((s) => s.closePanel);
  const platform = usePlatform();
  const camera = platform.camera;
  const bridge = platform.cameraBridge;
  const isSupported = useCameraStore((s) => s.isSupported);
  const detectSupport = useCameraStore((s) => s.detectSupport);
  const refreshCameras = useCameraStore((s) => s.refreshCameras);
  const stopSource = useCameraStore((s) => s.stopSource);
  const machineCamera = useCameraStore((s) => s.machineCamera);
  const detectMachineCamera = useCameraStore((s) => s.detectMachineCamera);

  useEffect(() => {
    detectSupport(camera);
    void refreshCameras(camera);
    // Probe the machine-integrated camera once on open; the button re-probes.
    if (machineCamera.kind === 'idle') void detectMachineCamera(bridge);
    return () => stopSource();
    // machineCamera is deliberately NOT a dependency: the probe fires once per
    // panel open, not on every probe-state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, bridge, detectSupport, refreshCameras, detectMachineCamera, stopSource]);

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
      <MachineCameraSection
        state={machineCamera}
        onDetect={() => void detectMachineCamera(bridge)}
      />
      {isSupported ? (
        <UsbCameraSection camera={camera} />
      ) : (
        <p style={noteStyle}>
          A USB webcam needs a Chromium browser over https/localhost — not available here. The
          machine camera above does not need it.
        </p>
      )}
      <AutoAlignControls />
      <OverlayControls />
    </div>
  );
}

// The UVC/getUserMedia half of the panel: device picker, live feed, and the
// start/stop control. Split from CameraPanelOpen to respect the function size
// limit and because it owns a distinct concern (browser webcams, not the
// machine-integrated camera above it).
function UsbCameraSection(props: { readonly camera: CameraAdapter | undefined }): JSX.Element {
  const { camera } = props;
  const cameras = useCameraStore((s) => s.cameras);
  const selectedDeviceId = useCameraStore((s) => s.selectedDeviceId);
  const sourceState = useCameraStore((s) => s.sourceState);
  const selectCamera = useCameraStore((s) => s.selectCamera);
  const startUsbSource = useCameraStore((s) => s.startUsbSource);
  const stopSource = useCameraStore((s) => s.stopSource);
  const wizardOpen = useCameraWizardStore((s) => s.open);
  const openWizard = useCameraWizardStore((s) => s.openWizard);

  const usbLive = sourceState.kind === 'live' && sourceState.source.kind === 'usb';
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
            if (usbLive || sourceState.kind === 'starting') {
              void startUsbSource(camera);
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
      {sourceState.kind === 'live' ? <CameraSourceView source={sourceState.source} /> : null}
      <div style={rowStyle}>
        {usbLive ? (
          <button
            type="button"
            className="lf-btn"
            onClick={stopSource}
            title="Stop the live camera feed."
          >
            Stop camera
          </button>
        ) : (
          <button
            type="button"
            className="lf-btn"
            disabled={sourceState.kind === 'starting'}
            onClick={() => void startUsbSource(camera)}
            title="Start the live USB camera feed."
          >
            {sourceState.kind === 'starting' ? 'Starting…' : 'Start USB camera'}
          </button>
        )}
        <button
          type="button"
          className="lf-btn"
          disabled={sourceState.kind !== 'live'}
          onClick={openWizard}
          title="Calibrate the camera lens: print a checkerboard, capture poses, and de-fisheye the feed."
        >
          Calibrate lens…
        </button>
      </div>
      <SourceNote sourceState={sourceState} />
      {wizardOpen ? <CameraCalibrationWizard /> : null}
    </>
  );
}

function MachineCameraSection(props: {
  readonly state: MachineCameraState;
  readonly onDetect: () => void;
}): JSX.Element {
  const { state } = props;
  const sourceState = useCameraStore((s) => s.sourceState);
  const activateMachineCamera = useCameraStore((s) => s.activateMachineCamera);
  const machineActive =
    sourceState.kind === 'live' && sourceState.source.kind !== 'usb';
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
        {state.kind === 'found' ? (
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            disabled={machineActive}
            onClick={activateMachineCamera}
            title="Use the machine camera for calibration, alignment, overlay, and trace."
          >
            {machineActive ? 'In use' : 'Use this camera'}
          </button>
        ) : null}
      </div>
      {state.kind === 'found' ? <NetworkCameraView frameUrl={state.proxyFrameUrl} /> : null}
      {state.kind === 'not-found' ? (
        <p style={noteStyle}>
          No machine camera found. Connect the laser by USB, power it on, then retry.
        </p>
      ) : null}
      {state.kind === 'unavailable' ? <p style={errStyle}>{state.reason}</p> : null}
    </div>
  );
}

function SourceNote(props: { readonly sourceState: CameraSourceState }): JSX.Element | null {
  const { sourceState } = props;
  if (sourceState.kind === 'denied') {
    return <p style={errStyle}>Permission denied. Allow camera access and press Start again.</p>;
  }
  if (sourceState.kind === 'error') {
    return <p style={errStyle}>{sourceState.message}</p>;
  }
  return null;
}

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
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingBottom: 8,
  borderBottom: '1px solid var(--lf-border)',
};
const noteStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', margin: 0 };
const errStyle: React.CSSProperties = { color: 'var(--lf-danger)', margin: 0 };
