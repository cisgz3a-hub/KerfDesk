// MachineCameraSection — bridge-discovered machine camera: detect, preview,
// manual 4-corner bed alignment (NetworkCameraView), and "Use this camera"
// which makes it the active source every camera feature captures through
// (ADR-116).

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
  const machineActive = sourceState.kind === 'live' && sourceState.source.kind === 'machine-jpeg';
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
      {state.kind === 'found' ? (
        <NetworkCameraView frameUrl={state.proxyFrameUrl} cameraUrl={state.cameraUrl} />
      ) : null}
      {state.kind === 'not-found' ? (
        <p style={noteStyle}>
          No machine camera found. Connect the laser by USB, power it on, then retry.
        </p>
      ) : null}
      {state.kind === 'unavailable' ? <p style={errStyle}>{state.reason}</p> : null}
    </div>
  );
}
