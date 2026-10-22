// CameraPickStep — the guided setup's first screen (ADR-663): which camera to
// set up. The laser's own camera, found through the bridge, and each USB
// camera are one card with one button; a network or phone camera opens below.
// Whatever starts here is the camera every feature then uses (ADR-116).

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { usePlatform } from '../../app';
import { DownloadDesktopLink } from '../../common/DownloadDesktopLink';
import { Icon, type IconName } from '../../kit/icons';
import { useCameraStore, type MachineCameraState } from '../../state/camera-store';
import { CameraSourceView } from '../CameraSourceView';
import { CameraFold } from '../panel/CameraFold';
import { cameraSourceName, MACHINE_CAMERA_NAME, usbCameraName } from '../panel/camera-names';
import { localCameraBridgeAvailable } from '../panel/camera-platform-capability';
import { PhoneCameraSection } from '../panel/PhoneCameraSection';
import { RtspSourceControls } from '../panel/RtspSourceControls';
import { useCameraCalibrationStore } from './camera-calibration-store';
import { WizardNav } from './WizardNav';
import { columnStyle, noteStyle } from './wizard-styles';

export function CameraPickStep(): JSX.Element {
  const platform = usePlatform();
  const bridgeAvailable = localCameraBridgeAvailable(platform.id, window.location.hostname);
  const sourceState = useCameraStore((s) => s.sourceState);
  const machineCamera = useCameraStore((s) => s.machineCamera);
  const cameras = useCameraStore((s) => s.cameras);
  const selectedDeviceId = useCameraStore((s) => s.selectedDeviceId);
  const isSupported = useCameraStore((s) => s.isSupported);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  useCameraDiscovery(bridgeAvailable);

  const live = sourceState.kind === 'live' ? sourceState.source : null;
  // Phone and RTSP sections show their own picture; the rest show it here.
  const showPreview =
    live !== null &&
    (live.kind === 'usb' ||
      (live.kind === 'machine-jpeg' &&
        machineCamera.kind === 'found' &&
        machineCamera.cameraUrl === live.cameraUrl));
  return (
    <div style={columnStyle}>
      <p style={leadStyle}>Which camera should KerfDesk use? Pick the one that looks at the bed.</p>
      <div style={listStyle}>
        {bridgeAvailable ? <MachineCameraChoice state={machineCamera} /> : <HostedNote />}
        {isSupported ? <UsbCameraChoices /> : null}
      </div>
      {bridgeAvailable ? (
        <CameraFold title="A network or phone camera" hint="RTSP, IP Webcam and others">
          <RtspSourceControls />
          <PhoneCameraSection />
        </CameraFold>
      ) : null}
      {showPreview && live !== null ? (
        <div style={previewStyle}>
          <CameraSourceView source={live} />
          <span style={noteStyle}>
            In use: {cameraSourceName(live, { cameras, selectedDeviceId, machineCamera })}
          </span>
        </div>
      ) : null}
      <WizardNav
        onNext={() => setStep({ kind: 'mount' })}
        nextDisabled={live === null}
        nextTitle="Go on with the camera in use."
      />
      {live === null ? <p style={noteStyle}>Start a camera to go on.</p> : null}
    </div>
  );
}

// The panel looks once on open; a wizard opened later looks again for what it lists.
function useCameraDiscovery(bridgeAvailable: boolean): void {
  const platform = usePlatform();
  const refreshCameras = useCameraStore((s) => s.refreshCameras);
  const detectMachineCamera = useCameraStore((s) => s.detectMachineCamera);
  useEffect(() => {
    void refreshCameras(platform.camera);
    if (bridgeAvailable && useCameraStore.getState().machineCamera.kind === 'idle') {
      void detectMachineCamera(platform.cameraBridge);
    }
  }, [bridgeAvailable, detectMachineCamera, platform, refreshCameras]);
}

function MachineCameraChoice(props: { readonly state: MachineCameraState }): JSX.Element {
  const { state } = props;
  const bridge = usePlatform().cameraBridge;
  const detectMachineCamera = useCameraStore((s) => s.detectMachineCamera);
  const activateMachineCamera = useCameraStore((s) => s.activateMachineCamera);
  const inUse = useCameraStore(
    (s) =>
      state.kind === 'found' &&
      s.sourceState.kind === 'live' &&
      s.sourceState.source.kind === 'machine-jpeg' &&
      s.sourceState.source.cameraUrl === state.cameraUrl,
  );
  const lookAgain = (
    <button
      type="button"
      className="lf-btn"
      onClick={() => void detectMachineCamera(bridge)}
      title="Look for the camera on the connected laser again."
    >
      Look again
    </button>
  );
  return (
    <ChoiceCard icon="laser" title={MACHINE_CAMERA_NAME} detail={machineDetail(state)}>
      {state.kind === 'found' ? (
        <UseButton inUse={inUse} onUse={activateMachineCamera} />
      ) : state.kind === 'detecting' || state.kind === 'idle' ? null : (
        lookAgain
      )}
    </ChoiceCard>
  );
}

function machineDetail(state: MachineCameraState): string {
  switch (state.kind) {
    case 'idle':
    case 'detecting':
      return 'Looking for it on your laser…';
    case 'found':
      return 'Found on your laser.';
    case 'not-found':
      return 'Not found. Connect the laser by USB, power it on, then look again.';
    case 'unavailable':
      return state.reason;
  }
}

function UsbCameraChoices(): JSX.Element {
  const camera = usePlatform().camera;
  const cameras = useCameraStore((s) => s.cameras);
  const selectedDeviceId = useCameraStore((s) => s.selectedDeviceId);
  const sourceState = useCameraStore((s) => s.sourceState);
  const selectCamera = useCameraStore((s) => s.selectCamera);
  const startUsbSource = useCameraStore((s) => s.startUsbSource);
  const usbLive = sourceState.kind === 'live' && sourceState.source.kind === 'usb';
  const starting = sourceState.kind === 'starting' && sourceState.sourceKind === 'usb';
  const use = (deviceId: string | null): void => {
    if (deviceId !== null && deviceId !== '') selectCamera(deviceId);
    void startUsbSource(camera);
  };
  // Before camera permission the browser lists no devices or unnamed ones;
  // one card then starts the default camera and asks for permission.
  const devices = cameras.filter((device) => device.deviceId !== '');
  if (devices.length === 0) {
    return (
      <ChoiceCard icon="camera" title="USB camera" detail="A webcam plugged into this computer.">
        <UseButton inUse={usbLive} starting={starting} onUse={() => use(null)} />
      </ChoiceCard>
    );
  }
  return (
    <>
      {devices.map((device) => (
        <ChoiceCard
          key={device.deviceId}
          icon="camera"
          title={usbCameraName(cameras, device.deviceId)}
          detail="USB camera on this computer."
        >
          <UseButton
            inUse={usbLive && selectedDeviceId === device.deviceId}
            starting={starting && selectedDeviceId === device.deviceId}
            onUse={() => use(device.deviceId)}
          />
        </ChoiceCard>
      ))}
    </>
  );
}

function UseButton(props: {
  readonly inUse: boolean;
  readonly starting?: boolean;
  readonly onUse: () => void;
}): JSX.Element {
  if (props.inUse) {
    return (
      <span style={inUseStyle}>
        <Icon name="check" size={14} /> In use
      </span>
    );
  }
  return (
    <button
      type="button"
      className="lf-btn"
      disabled={props.starting === true}
      onClick={props.onUse}
      title="Start this camera and use it for the canvas picture, calibration and trace."
    >
      {props.starting === true ? 'Starting…' : 'Use this camera'}
    </button>
  );
}

function ChoiceCard(props: {
  readonly icon: IconName;
  readonly title: string;
  readonly detail: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div style={cardStyle}>
      <span style={iconStyle}>
        <Icon name={props.icon} size={22} />
      </span>
      <span style={textStyle}>
        <strong>{props.title}</strong>
        <span style={detailStyle}>{props.detail}</span>
      </span>
      {props.children}
    </div>
  );
}

function HostedNote(): JSX.Element {
  return (
    <div style={cardStyle}>
      <span style={iconStyle}>
        <Icon name="laser" size={22} />
      </span>
      <span style={textStyle}>
        <strong>{MACHINE_CAMERA_NAME}</strong>
        <span style={detailStyle}>
          A laser&apos;s camera, network and phone cameras need KerfDesk Desktop, which reads them
          through its own local bridge.
        </span>
        <DownloadDesktopLink />
      </span>
    </div>
  );
}

const leadStyle: CSSProperties = { margin: 0, fontWeight: 600 };
const listStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const cardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
};
const iconStyle: CSSProperties = { color: 'var(--lf-accent-fg)', flex: 'none' };
const textStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 0,
};
const detailStyle: CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const inUseStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  color: 'var(--lf-accent-fg)',
  fontWeight: 600,
};
const previewStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxWidth: 480,
};
