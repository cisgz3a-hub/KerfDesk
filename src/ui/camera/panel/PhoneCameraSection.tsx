// PhoneCameraSection — a phone as the overhead camera (ADR-448). The phone
// runs a camera app that serves still pictures on the local network (IP
// Webcam on Android, or any app with a picture address), and KerfDesk reads
// them through the camera bridge like a laser's built-in camera. Once started
// it is the camera every feature uses, with its own calibration (ADR-446).

import { useState } from 'react';
import { usePlatform } from '../../app';
import { loadPhoneCamera, savePhoneCamera } from '../../state/camera-preference-storage';
import { type CameraSourceState, useCameraStore } from '../../state/camera-store';
import { CameraSourceView } from '../CameraSourceView';
import { publicCameraSourceId, type ActiveCameraSource } from '../frame-source';
import { phoneCameraAddress, phoneSnapshotUrl, type PhoneCameraApp } from '../phone-camera-address';
import { errStyle, noteStyle, rowStyle, sectionStyle } from './panel-styles';

type PhoneControl =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'live';
      readonly source: Extract<ActiveCameraSource, { readonly kind: 'machine-jpeg' }>;
    };

export function PhoneCameraSection(): JSX.Element {
  const phone = usePhoneCamera();
  const { app, control, message } = phone;
  return (
    <details style={sectionStyle} open={phone.remembered}>
      <summary style={summaryStyle} title="Use a phone above the bed as the camera.">
        Phone camera…
      </summary>
      <p style={noteStyle}>
        A phone running a camera app on the same Wi-Fi as this computer. A phone that shows up as a
        webcam (Continuity Camera on a Mac, or a webcam app with its computer driver) is started
        under USB camera instead.
      </p>
      <select
        aria-label="Camera app on the phone"
        title="The app that serves the phone's camera on your network."
        value={app}
        onChange={(e) => phone.chooseApp(e.currentTarget.value === 'other' ? 'other' : 'ip-webcam')}
      >
        <option value="ip-webcam">IP Webcam (Android)</option>
        <option value="other">Another app with a picture address</option>
      </select>
      <PhoneAddressRow phone={phone} />
      {message === null ? null : (
        <p role="status" style={errStyle}>
          {message}
        </p>
      )}
      {control.kind === 'live' ? (
        <CameraSourceView source={control.source} />
      ) : (
        <PhoneSetupSteps app={app} />
      )}
    </details>
  );
}

type PhoneCamera = ReturnType<typeof usePhoneCamera>;

function usePhoneCamera() {
  const bridge = usePlatform().cameraBridge;
  const startSnapshotSource = useCameraStore((s) => s.startSnapshotSource);
  const stopSource = useCameraStore((s) => s.stopSource);
  const sourceState = useCameraStore((s) => s.sourceState);
  const [stored] = useState(loadPhoneCamera);
  const [app, setApp] = useState<PhoneCameraApp>(stored?.app ?? 'ip-webcam');
  const [typed, setTyped] = useState(stored?.address ?? '');
  const [startedUrl, setStartedUrl] = useState(() =>
    stored === null ? null : phoneSnapshotUrl(stored.app, stored.address),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const control = phoneControl(sourceState, startedUrl);

  const connect = (): void => {
    const address = phoneCameraAddress(app, typed);
    if (address.kind === 'invalid') {
      setProblem(address.message);
      return;
    }
    setProblem(null);
    savePhoneCamera({ app, address: typed });
    setStartedUrl(address.url);
    void startSnapshotSource(bridge, address.url);
  };

  return {
    remembered: stored !== null,
    app,
    typed,
    control,
    message: problem ?? (control.kind === 'error' ? control.message : null),
    chooseApp: (next: PhoneCameraApp): void => {
      setApp(next);
      setProblem(null);
    },
    type: (next: string): void => {
      setTyped(next);
      setProblem(null);
    },
    connect,
    stop: stopSource,
  };
}

function PhoneAddressRow(props: { readonly phone: PhoneCamera }): JSX.Element {
  const { app, control, typed } = props.phone;
  const live = control.kind === 'live';
  return (
    <div style={rowStyle}>
      <input
        type="text"
        aria-label="Phone camera address"
        title="The address the app shows on the phone's screen."
        placeholder={app === 'ip-webcam' ? '192.168.1.50:8080' : 'http://…/picture.jpg'}
        value={typed}
        onChange={(e) => props.phone.type(e.currentTarget.value)}
        style={addressStyle}
      />
      <button
        type="button"
        className="lf-btn"
        disabled={control.kind === 'starting' || (!live && typed.trim() === '')}
        onClick={live ? props.phone.stop : props.phone.connect}
        title={
          live
            ? 'Stop the phone camera.'
            : 'Fetch a picture from the phone and use it as the camera.'
        }
      >
        {buttonLabel(control)}
      </button>
    </div>
  );
}

// What makes a phone a good bed camera: a fixed, straight-down view with
// nothing in the app changing the picture after calibration.
function PhoneSetupSteps(props: { readonly app: PhoneCameraApp }): JSX.Element {
  return (
    <ol style={stepsStyle}>
      {props.app === 'ip-webcam' ? (
        <>
          <li>
            In IP Webcam, set Video preferences › Video resolution to the largest, then tap Start
            server.
          </li>
          <li>Type the address it shows at the bottom of the screen.</li>
        </>
      ) : (
        <li>Type the address of the app&apos;s still picture, not its video stream.</li>
      )}
      <li>Mount the phone looking straight down over the bed, clear of the head and gantry.</li>
      <li>Turn off zoom, stabilisation, HDR and filters; lock focus if the app can.</li>
      <li>Keep it on its charger, and let the app keep the screen from sleeping.</li>
      <li>Calibrate once it is mounted. If the phone moves, Check camera… shows it.</li>
    </ol>
  );
}

function phoneControl(state: CameraSourceState, startedUrl: string | null): PhoneControl {
  // The laser's built-in camera is a still-picture source too, so the phone's
  // is the one at the address this section started.
  if (state.kind === 'live' && state.source.kind === 'machine-jpeg') {
    return startedUrl !== null && sameCamera(state.source.cameraUrl, startedUrl)
      ? { kind: 'live', source: state.source }
      : { kind: 'idle' };
  }
  // Only this section starts a still-picture source, so starting and error are its own.
  if (state.kind === 'starting' && state.sourceKind === 'machine-jpeg') return { kind: 'starting' };
  if (state.kind === 'error' && state.sourceKind === 'machine-jpeg') {
    return { kind: 'error', message: state.message };
  }
  return { kind: 'idle' };
}

function sameCamera(a: string, b: string): boolean {
  return publicCameraSourceId(a) === publicCameraSourceId(b);
}

function buttonLabel(control: PhoneControl): string {
  switch (control.kind) {
    case 'live':
      return 'Stop';
    case 'starting':
      return 'Connecting…';
    case 'error':
      return 'Try again';
    case 'idle':
      return 'Use phone';
  }
}

const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const addressStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const stepsStyle: React.CSSProperties = {
  ...noteStyle,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  paddingLeft: 18,
  fontSize: 12,
};
