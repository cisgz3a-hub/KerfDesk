// CameraFrameNotice — what the Camera panel says about the running camera's
// calibration in the bed frame now (rolling audit 12-P2-2): how far its
// picture moved, or why it is not used. A calibration saved before its bed
// frame was recorded gets Confirm bed and origin beside the reason (ADR-440 Amendment 2).

import type { CSSProperties } from 'react';
import type { CameraBedFrameNote } from '../../core/camera/model/camera-bed-frame';
import { confirmOwnCameraBedFrame } from './calibrate/confirm-bed-frame';

export function CameraFrameNotice(props: {
  readonly note: CameraBedFrameNote;
  readonly style: CSSProperties;
}): JSX.Element {
  const { note } = props;
  if (note.frameUnrecorded !== true) {
    return (
      <p role="status" style={props.style}>
        {note.message}
      </p>
    );
  }
  return (
    <div role="status" style={{ ...props.style, ...columnStyle }}>
      <span>{note.message}</span>
      <span>
        <button
          type="button"
          className="lf-btn"
          onClick={() => confirmOwnCameraBedFrame()}
          title="Machine Setup has the same origin and bed size as when this camera was calibrated: use the calibration again."
        >
          Confirm bed and origin
        </button>
      </span>
    </div>
  );
}

const columnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
