// TimelapseResult — the last job's timelapse (ADR-490): its frame count while
// recording, then a player and Save video once the job has ended.

import { useState } from 'react';
import { timelapseVideoSeconds } from '../../../core/camera/job-watch/timelapse-frames';
import { usePlatform } from '../../app';
import { pickPreparedSaveTarget } from '../../app/pick-prepared-save-target';
import { useToastStore } from '../../state/toast-store';
import { noteStyle, rowStyle } from '../panel/panel-styles';
import { useJobWatchStore, type TimelapseView } from './job-watch-store';
import { encodeTimelapseVideo, timelapseVideoFormat } from './timelapse-video';
import { TimelapsePlayer } from './TimelapsePlayer';

export function TimelapseResult(props: { readonly timelapse: TimelapseView }): JSX.Element {
  const { timelapse } = props;
  const count = timelapse.frames.length;
  return (
    <div style={blockStyle} aria-label="Timelapse">
      {timelapse.recording ? (
        <span>
          Recording the timelapse: {count} {count === 1 ? 'frame' : 'frames'}, one every{' '}
          {Math.round(timelapse.intervalMs / 1000)} s.
        </span>
      ) : null}
      {!timelapse.recording && count > 0 ? <FinishedTimelapse timelapse={timelapse} /> : null}
      {timelapse.note !== null ? <p style={noteStyle}>{timelapse.note}</p> : null}
    </div>
  );
}

function FinishedTimelapse(props: { readonly timelapse: TimelapseView }): JSX.Element {
  const { frames, flat } = props.timelapse;
  const clear = useJobWatchStore((s) => s.clearTimelapse);
  const { save, savingFrame, unsupported } = useSaveVideo(frames);
  return (
    <>
      <TimelapsePlayer frames={frames} />
      <span style={noteStyle}>
        {frames.length} frames, about{' '}
        {Math.max(1, Math.round(timelapseVideoSeconds(frames.length)))} s of video
        {flat ? ', seen square-on from above the job' : ''}.
      </span>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn"
          disabled={unsupported !== null || savingFrame !== null}
          title={unsupported ?? 'Save the timelapse as a video file.'}
          onClick={() => void save()}
        >
          {savingFrame === null
            ? 'Save video…'
            : `Making the video: ${savingFrame} of ${frames.length}`}
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={savingFrame !== null}
          onClick={clear}
          title="Throw this timelapse away."
        >
          Clear
        </button>
      </div>
    </>
  );
}

function useSaveVideo(frames: ReadonlyArray<Blob>): {
  readonly save: () => Promise<void>;
  readonly savingFrame: number | null;
  readonly unsupported: string | null;
} {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  const [savingFrame, setSavingFrame] = useState<number | null>(null);
  const [format] = useState(timelapseVideoFormat);
  const save = async (): Promise<void> => {
    if (format === null) return;
    // The picker empties an existing file as it returns (ADR-656), so the
    // video is made first; the long encode then asks for a fresh click.
    setSavingFrame(0);
    // MediaRecorder and captureStream can still throw after isTypeSupported;
    // a throw then counts as a failed recording and re-enables Save.
    const video = await encodeTimelapseVideo(frames, format, setSavingFrame)
      .catch(() => null)
      .finally(() => setSavingFrame(null));
    if (video === null) {
      pushToast('Could not make the timelapse video.', 'error');
      return;
    }
    try {
      const target = await pickPreparedSaveTarget(
        platform,
        { suggestedName: `timelapse${format.extension}`, extensions: [format.extension] },
        { title: 'Save timelapse video', message: 'The timelapse video is ready.' },
      );
      if (target === null) return;
      await target.write(video);
      pushToast('Timelapse video saved.', 'success');
    } catch (error) {
      pushToast(
        'Could not save the timelapse video: ' +
          (error instanceof Error ? error.message : String(error)),
        'error',
      );
    }
  };
  return {
    save,
    savingFrame,
    unsupported: format === null ? 'This browser cannot record video.' : null,
  };
}

const blockStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
