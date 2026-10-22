// CameraSettingsView — the Camera panel's settings page (ADR-663): what is set
// once or now and then, out of the everyday panel. Which camera (the laser's
// own through the bridge, RTSP, a phone app, or USB; ADR-116, ADR-448), its
// calibration (set up, recalibrate, check, the accuracy map and every
// calibrated camera; ADR-441, ADR-446), the helpers that start the camera and
// refresh its picture by themselves (Amendment 1), a snapshot, and the
// diagnostics.

import type { CSSProperties, ReactNode } from 'react';
import type { CameraAdapter, CameraBridgeAdapter } from '../../../platform/types';
import { DownloadDesktopLink } from '../../common/DownloadDesktopLink';
import { useCameraStore } from '../../state/camera-store';
import { useCameraHelpersStore } from '../helpers/camera-helpers-store';
import { CalibrateCameraControls } from '../calibrate/CalibrateCameraControls';
import { CameraDiagnostics } from './CameraDiagnostics';
import { MachineCameraSection } from './MachineCameraSection';
import { PhoneCameraSection } from './PhoneCameraSection';
import { RtspSourceControls } from './RtspSourceControls';
import { SavedCamerasSection } from './SavedCamerasSection';
import { SnapshotControls } from './SnapshotControls';
import { UsbCameraSection } from './UsbCameraSection';
import { noteStyle } from './panel-styles';

export function CameraSettingsView(props: {
  readonly camera: CameraAdapter | undefined;
  readonly bridge: CameraBridgeAdapter | undefined;
  readonly bridgeAvailable: boolean;
  readonly wide: boolean;
  readonly onToggleWide: () => void;
}): JSX.Element {
  const isSupported = useCameraStore((s) => s.isSupported);
  const machineCamera = useCameraStore((s) => s.machineCamera);
  const detectMachineCamera = useCameraStore((s) => s.detectMachineCamera);
  return (
    <div style={columnStyle}>
      <SettingsGroup title="Which camera">
        {props.bridgeAvailable ? (
          <>
            <MachineCameraSection
              state={machineCamera}
              onDetect={() => void detectMachineCamera(props.bridge)}
            />
            <RtspSourceControls />
            <PhoneCameraSection />
          </>
        ) : (
          <HostedNetworkCameraNotice />
        )}
        {isSupported ? (
          <UsbCameraSection camera={props.camera} />
        ) : (
          <p style={noteStyle}>
            A USB webcam needs a Chromium browser over https/localhost — not available here. The
            machine camera above does not need it.
          </p>
        )}
      </SettingsGroup>
      <SettingsGroup title="Calibration">
        <CalibrateCameraControls />
        <SavedCamerasSection />
      </SettingsGroup>
      <SettingsGroup title="Helpers">
        <CameraHelpersControls />
      </SettingsGroup>
      <SettingsGroup title="Picture">
        <SnapshotControls wide={props.wide} onToggleWide={props.onToggleWide} />
      </SettingsGroup>
      <CameraDiagnostics bridgeAvailable={props.bridgeAvailable} />
    </div>
  );
}

function CameraHelpersControls(): JSX.Element {
  const settings = useCameraHelpersStore((s) => s.settings);
  const setSettings = useCameraHelpersStore((s) => s.setSettings);
  return (
    <>
      <label style={checkStyle}>
        <input
          type="checkbox"
          title="Start the camera used last when this panel opens, and once calibrated with KerfDesk and when the laser connects."
          checked={settings.autoStart}
          onChange={(event) => setSettings({ autoStart: event.currentTarget.checked })}
        />
        <span>
          Start my camera by itself
          <span style={hintStyle}>
            The camera used last starts when this panel opens. Once it is calibrated it also starts
            with KerfDesk and when the laser connects.
          </span>
        </span>
      </label>
      <label style={checkStyle}>
        <input
          type="checkbox"
          title="Take a held camera picture again when a job finishes."
          checked={settings.refreshAfterJob}
          onChange={(event) => setSettings({ refreshAfterJob: event.currentTarget.checked })}
        />
        <span>
          Refresh the picture after each job
          <span style={hintStyle}>A held picture is taken again when a job finishes.</span>
        </span>
      </label>
      <p style={noteStyle}>Press Alt+C to refresh the picture at any time.</p>
    </>
  );
}

function SettingsGroup(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section style={groupStyle} aria-label={props.title}>
      <h3 style={groupTitleStyle}>{props.title}</h3>
      {props.children}
    </section>
  );
}

// Why the machine camera works in Desktop and not here: the laser's camera
// serves plain http on the local network without CORS, so an https page may
// at most display it (Chrome's Local Network Access) and can never read its
// pixels, which calibration, the corrected overlay and trace all need. A
// phone camera app is the same kind of local-network camera (ADR-448).
function HostedNetworkCameraNotice(): JSX.Element {
  return (
    <div style={hostedNoticeStyle}>
      <strong>USB cameras work here.</strong>
      <span>
        So does a phone that shows up as a webcam (Continuity Camera on a Mac, or a webcam app with
        its computer driver). A laser&apos;s built-in camera, RTSP/IP cameras and phone camera apps
        cannot be read by a web page: they answer on your local network without the permission
        browsers require. KerfDesk Desktop reads them through its own local camera bridge, with
        nothing to set up.
      </span>
      <DownloadDesktopLink />
    </div>
  );
}

const columnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const groupStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const groupTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--lf-text-faint)',
};
const checkStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 6 };
const hintStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--lf-text-faint)',
};
const hostedNoticeStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  padding: 8,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  background: 'var(--lf-bg-1)',
};
