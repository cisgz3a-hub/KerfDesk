// CameraPanel — the LightBurn-style Camera Control panel (ADR-107/116): pick
// a camera (machine-integrated via the bridge, RTSP by URL, or USB), start it
// as the active source, calibrate the lens, align to the bed, control the
// workspace overlay, and self-check via Diagnostics. Opened from the top
// toolbar / Tools menu via the `tools.camera` command (like the registration
// jig); it renders nothing until opened, and its own × button closes it.

import { useEffect } from 'react';
import { usePlatform } from '../../app';
import { useCameraStore } from '../../state/camera-store';
import { AutoAlignControls } from '../AutoAlignControls';
import { OverlayControls } from '../OverlayControls';
import { CameraDiagnostics } from './CameraDiagnostics';
import { MachineCameraSection } from './MachineCameraSection';
import { noteStyle } from './panel-styles';
import { RtspSourceControls } from './RtspSourceControls';
import { UsbCameraSection } from './UsbCameraSection';

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
        <strong>Camera</strong>
        <button
          type="button"
          className="lf-btn"
          onClick={close}
          aria-label="Close camera panel"
          title="Close the camera panel."
        >
          ×
        </button>
      </div>
      <MachineCameraSection
        state={machineCamera}
        onDetect={() => void detectMachineCamera(bridge)}
      />
      <RtspSourceControls />
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
      <CameraDiagnostics />
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  zIndex: 5,
  width: 320,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
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
