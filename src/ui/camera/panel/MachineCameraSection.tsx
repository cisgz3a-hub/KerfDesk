// MachineCameraSection — bridge-discovered machine camera: detect, preview
// (NetworkCameraView), and "Use this camera" which makes it the active source
// every camera feature captures through (ADR-116).

import type { MachineCameraState } from '../../state/camera-store';
import { useCameraStore } from '../../state/camera-store';
import { NetworkCameraView } from '../NetworkCameraView';
import { errStyle, noteStyle, rowStyle, sectionStyle } from './panel-styles';

export function MachineCameraSection(props: {
  readonly state: MachineCameraState;
  readonly onDetect: () => void;
}): JSX.Element {
  const { state } = props;
  const sourceState = useCameraStore((s) => s.sourceState);
  const activateMachineCamera = useCameraStore((s) => s.activateMachineCamera);
  // A phone camera is a still-picture source too (ADR-448), so match the address.
  const machineActive =
    state.kind === 'found' &&
    sourceState.kind === 'live' &&
    sourceState.source.kind === 'machine-jpeg' &&
    sourceState.source.cameraUrl === state.cameraUrl;
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
            title="Use the machine camera for calibration, the canvas overlay, and trace."
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
