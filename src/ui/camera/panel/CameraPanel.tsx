// CameraPanel — the LightBurn-style Camera Control panel (ADR-107/116): pick
// a camera (machine-integrated via the bridge, RTSP by URL, or USB), start it
// as the active source, calibrate the lens, align to the bed, control the
// workspace overlay, and self-check via Diagnostics. Opened from the top
// toolbar / Tools menu via the `tools.camera` command (like the registration
// jig); it renders nothing until opened, and its own × button closes it.

import { useEffect, useState } from 'react';
import { usePlatform } from '../../app';
import { loadCameraPanelWide, saveCameraPanelWide } from '../../state/camera-preference-storage';
import { useCameraStore } from '../../state/camera-store';
import { AutoAlignControls } from '../AutoAlignControls';
import { OverlayControls } from '../OverlayControls';
import { CameraDiagnostics } from './CameraDiagnostics';
import { CameraSetupSteps } from './CameraSetupSteps';
import { MachineCameraSection } from './MachineCameraSection';
import { noteStyle } from './panel-styles';
import { RtspSourceControls } from './RtspSourceControls';
import { SnapshotControls } from './SnapshotControls';
import { UsbCameraSection } from './UsbCameraSection';
import { localCameraBridgeAvailable } from './camera-platform-capability';
import { DownloadDesktopLink } from '../../common/DownloadDesktopLink';

export function CameraPanel(): JSX.Element | null {
  const open = useCameraStore((s) => s.panelOpen);
  return open ? <CameraPanelOpen /> : null;
}

function CameraPanelOpen(): JSX.Element {
  const close = useCameraStore((s) => s.closePanel);
  const platform = usePlatform();
  const camera = platform.camera;
  const bridge = platform.cameraBridge;
  const bridgeAvailable = localCameraBridgeAvailable(platform.id, window.location.hostname);
  const isSupported = useCameraStore((s) => s.isSupported);
  const detectSupport = useCameraStore((s) => s.detectSupport);
  const refreshCameras = useCameraStore((s) => s.refreshCameras);
  const stopSource = useCameraStore((s) => s.stopSource);
  const machineCamera = useCameraStore((s) => s.machineCamera);
  const detectMachineCamera = useCameraStore((s) => s.detectMachineCamera);
  const [wide, setWide] = useState(() => loadCameraPanelWide());
  const toggleWide = (): void => {
    setWide((current) => {
      saveCameraPanelWide(!current);
      return !current;
    });
  };

  useEffect(() => {
    detectSupport(camera);
    void refreshCameras(camera);
    // Probe the machine-integrated camera once on open; the button re-probes.
    if (bridgeAvailable && machineCamera.kind === 'idle') void detectMachineCamera(bridge);
    return () => stopSource();
    // machineCamera is deliberately NOT a dependency: the probe fires once per
    // panel open, not on every probe-state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    camera,
    bridge,
    bridgeAvailable,
    detectSupport,
    refreshCameras,
    detectMachineCamera,
    stopSource,
  ]);

  return (
    <div
      role="dialog"
      aria-label="Camera preview"
      style={{ ...panelStyle, width: wide ? WIDE_PANEL_WIDTH_PX : PANEL_WIDTH_PX }}
    >
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
      <CameraSetupSteps />
      {bridgeAvailable ? (
        <>
          <MachineCameraSection
            state={machineCamera}
            onDetect={() => void detectMachineCamera(bridge)}
          />
          <RtspSourceControls />
        </>
      ) : (
        <HostedNetworkCameraNotice />
      )}
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
      <SnapshotControls wide={wide} onToggleWide={toggleWide} />
      <CameraDiagnostics bridgeAvailable={bridgeAvailable} />
    </div>
  );
}

function HostedNetworkCameraNotice(): JSX.Element {
  return (
    <div style={hostedNoticeStyle}>
      <strong>USB camera available here.</strong>
      <span>
        Machine and RTSP/IP cameras need KerfDesk Desktop, which runs the secure local camera bridge
        automatically.
      </span>
      <DownloadDesktopLink />
    </div>
  );
}

// Compact fits beside the layers panel; wide is the F-CAM9 monitoring view.
const PANEL_WIDTH_PX = 320;
const WIDE_PANEL_WIDTH_PX = 560;

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  zIndex: 5,
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
const hostedNoticeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  padding: 8,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  background: 'var(--lf-bg-1)',
};
