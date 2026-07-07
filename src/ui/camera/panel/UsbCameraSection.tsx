// UsbCameraSection — the UVC/getUserMedia half of the Camera panel: device
// picker, live feed, start/stop, and the lens-calibration wizard launcher.
// "Calibrate lens…" is enabled for ANY live source (ADR-116), not just USB —
// the wizard captures through the active source.

import type { CameraAdapter } from '../../../platform/types';
import { type CameraSourceState, useCameraStore } from '../../state/camera-store';
import { CameraSourceView } from '../CameraSourceView';
import { CameraCalibrationWizard } from '../wizard/CameraCalibrationWizard';
import { useCameraWizardStore } from '../wizard/camera-wizard-store';
import { errStyle, rowStyle } from './panel-styles';

export function UsbCameraSection(props: {
  readonly camera: CameraAdapter | undefined;
}): JSX.Element {
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
      {/* Machine sources already show in the machine-camera section above —
          rendering them here too doubled the view AND the polling load on a
          single-threaded camera (found during the hardware pass). */}
      {usbLive ? <CameraSourceView source={sourceState.source} /> : null}
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

const selectStyle: React.CSSProperties = { width: '100%' };
