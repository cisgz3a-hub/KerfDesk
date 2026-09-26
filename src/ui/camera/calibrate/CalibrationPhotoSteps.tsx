// The middle of the camera calibration wizard (ADR-441): watch the target
// engrave, then take the one photo. The photo is fitted in a worker, and the
// operator can cancel a fit that is taking too long.

import { useEffect, useRef } from 'react';
import type { StreamerState } from '../../../core/controllers/grbl';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { CameraSourceView } from '../CameraSourceView';
import { photographTarget } from './calibration-actions';
import { useCameraCalibrationStore, type PhotoStatus } from './camera-calibration-store';
import { columnStyle, errStyle, noteStyle, rowStyle } from './wizard-styles';

export function EngravingStep(props: {
  readonly started: boolean;
  readonly earlierJob: StreamerState | null;
}): JSX.Element {
  const current = useLaserStore((s) => s.streamer);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const { started } = props;
  const streamer = current === props.earlierJob ? null : current;

  useEffect(() => {
    if (!started || streamer === null) return;
    if (streamer.status === 'done') {
      setStep({ kind: 'photo', status: { kind: 'idle' } });
      return;
    }
    if (
      streamer.status === 'errored' ||
      streamer.status === 'cancelled' ||
      streamer.status === 'disconnected'
    ) {
      setStep({
        kind: 'setup',
        note: `The target did not finish engraving (${streamer.status}). Fix the cause and engrave again.`,
      });
    }
  }, [started, streamer, setStep]);

  if (!started) {
    return (
      <p style={noteStyle}>
        Preparing the target job. Review it and confirm in the dialogs that follow; the machine
        frames the target before it engraves.
      </p>
    );
  }
  const progress =
    streamer !== null && streamer.total > 0
      ? ` ${Math.round((streamer.completed / streamer.total) * 100)}%`
      : '';
  return (
    <p style={noteStyle}>
      Engraving the target{progress}. Keep clear of the machine and do not move the sheet. The
      wizard goes on to the photo when the job finishes.
    </p>
  );
}

export function PhotoStep(props: { readonly status: PhotoStatus }): JSX.Element {
  const sourceState = useCameraStore((s) => s.sourceState);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const { take, cancel } = usePhotoRun();
  const running = props.status.kind === 'running';

  return (
    <div style={columnStyle}>
      <p style={noteStyle}>
        Leave the engraved sheet exactly where it is. Move the laser head to a corner so it does not
        cover the three solid discs in the middle, light the bed evenly, and put the lid where it
        normally sits when you work.
      </p>
      {sourceState.kind === 'live' ? (
        <CameraSourceView source={sourceState.source} />
      ) : (
        <p style={errStyle}>
          No camera is running. Start one in the Camera panel, then take the photo.
        </p>
      )}
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={sourceState.kind !== 'live' || running}
          onClick={() => void take()}
          title="Take one photo of the target and fit the camera to it."
        >
          {running ? 'Measuring the rings…' : 'Take photo'}
        </button>
        {running ? (
          <button
            type="button"
            className="lf-btn"
            onClick={cancel}
            title="Stop measuring this photo."
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="lf-btn"
            onClick={() => setStep({ kind: 'setup', note: null })}
            title="Back to the target settings."
          >
            Back
          </button>
        )}
      </div>
      {props.status.kind === 'failed' ? <p style={errStyle}>{props.status.message}</p> : null}
    </div>
  );
}

// One photo run at a time. Cancelling, closing the wizard or leaving the step
// aborts the run, and a late answer from an aborted run is dropped.
function usePhotoRun(): { readonly take: () => Promise<void>; readonly cancel: () => void } {
  const settings = useCameraCalibrationStore((s) => s.settings);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const bedWidthMm = useStore((s) => s.project.device.bedWidth);
  const bedHeightMm = useStore((s) => s.project.device.bedHeight);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const take = async (): Promise<void> => {
    const { sourceState } = useCameraStore.getState();
    if (sourceState.kind !== 'live') return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStep({ kind: 'photo', status: { kind: 'running' } });
    try {
      const outcome = await photographTarget({
        source: sourceState.source,
        settings,
        bedWidthMm,
        bedHeightMm,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setStep(
        outcome.kind === 'ok'
          ? { kind: 'result', result: outcome.result }
          : { kind: 'photo', status: { kind: 'failed', message: outcome.message } },
      );
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setStep({ kind: 'photo', status: { kind: 'failed', message } });
    }
  };
  const cancel = (): void => {
    controllerRef.current?.abort();
    setStep({ kind: 'photo', status: { kind: 'idle' } });
  };
  return { take, cancel };
}
