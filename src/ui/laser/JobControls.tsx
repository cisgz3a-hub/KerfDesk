// JobControls — Home + Start / Pause / Resume / Stop + progress bar.
// F-B3 (Home), F-B6 (Start), F-B7 (Pause/Resume), F-B8 (Stop), F-B11 (Progress).

import { progress } from '../../core/controllers/grbl';
import {
  compileJob,
  computeJobBounds,
  describeFramePreflightFailure,
  framePreflight,
} from '../../core/job';
import { useStore } from '../state';
import { describeAutofocusResult, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';

type Props = {
  readonly disabled: boolean;
  readonly onStartJob: () => void;
};

export function JobControls({ disabled, onStartJob }: Props): JSX.Element {
  const streamer = useLaserStore((s) => s.streamer);
  const isStreaming = streamer !== null && streamer.status === 'streaming';
  const isPaused = streamer !== null && streamer.status === 'paused';
  return (
    <div style={containerStyle}>
      <SetupRow disabled={disabled} streaming={isStreaming || isPaused} onStartJob={onStartJob} />
      {(isStreaming || isPaused) && (
        <RunningControls isStreaming={isStreaming} isPaused={isPaused} />
      )}
      {streamer !== null && streamer.total > 0 && <ProgressBar streamer={streamer} />}
    </div>
  );
}

function SetupRow(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
  readonly onStartJob: () => void;
}): JSX.Element {
  const onFrame = useFrameAction();
  const onAutofocus = useAutofocusAction();
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  const home = useLaserStore((s) => s.home);
  const busy = props.disabled || props.streaming;
  // Disabled when the command is empty — there's no portable autofocus
  // G-code (see DeviceProfile.autofocusCommand docs); shipping a default
  // we picked would break someone's machine, so the button is dark until
  // the user pastes their machine's command.
  const noAutofocus = autofocusCommand.trim() === '';
  return (
    <div style={rowStyle}>
      <button type="button" onClick={() => void home()} disabled={props.disabled}>
        Home
      </button>
      <button
        type="button"
        onClick={onAutofocus}
        disabled={busy || noAutofocus}
        title={
          noAutofocus
            ? 'Set your machine’s autofocus command in Device settings below'
            : 'Run the autofocus command configured in Device settings'
        }
      >
        Auto-focus
      </button>
      <button type="button" onClick={onFrame} disabled={busy}>
        Frame
      </button>
      <button type="button" onClick={props.onStartJob} disabled={busy}>
        Start job
      </button>
    </div>
  );
}

function RunningControls(props: {
  readonly isStreaming: boolean;
  readonly isPaused: boolean;
}): JSX.Element {
  const pauseJob = useLaserStore((s) => s.pauseJob);
  const resumeJob = useLaserStore((s) => s.resumeJob);
  const stopJob = useLaserStore((s) => s.stopJob);
  return (
    <div style={rowStyle}>
      {props.isStreaming && (
        <button type="button" onClick={pauseJob}>
          Pause
        </button>
      )}
      {props.isPaused && (
        <button type="button" onClick={() => void resumeJob()}>
          Resume
        </button>
      )}
      <button type="button" onClick={() => void stopJob()} style={stopBtnStyle}>
        Stop
      </button>
    </div>
  );
}

function ProgressBar({
  streamer,
}: {
  readonly streamer: NonNullable<ReturnType<typeof useLaserStore.getState>['streamer']>;
}): JSX.Element {
  return (
    <div style={progressContainerStyle}>
      <div style={{ ...progressFillStyle, width: `${Math.round(progress(streamer) * 100)}%` }} />
      <div style={progressLabelStyle}>
        {streamer.completed} / {streamer.total} lines
      </div>
    </div>
  );
}

function useFrameAction(): () => void {
  const project = useStore((s) => s.project);
  const frame = useLaserStore((s) => s.frame);
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    const job = compileJob(project.scene, project.device);
    const bounds = computeJobBounds(job);
    if (bounds === null) {
      pushToast('Nothing to frame — enable Output on at least one layer.', 'warning');
      return;
    }
    // Refuse to drive the head off-bed. The Falcon (and most diode
    // lasers) ship with $20=0, so any X/Y past the soft-limits skips
    // steps mechanically — the operator hears grinding and the trace
    // collapses to a sideways line because the axis that hit the stop
    // can't keep up. Better to refuse here with a clear instruction.
    const pre = framePreflight(bounds, project.device);
    if (pre.kind === 'out-of-bounds') {
      pushToast(describeFramePreflightFailure(pre), 'error');
      return;
    }
    const feed = Math.min(project.device.maxFeed, 5000);
    void frame(bounds, feed);
  };
}

function useAutofocusAction(): () => void {
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  const autofocus = useLaserStore((s) => s.autofocus);
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    if (autofocusCommand.trim() === '') {
      pushToast('No autofocus command configured. Set it in Device settings.', 'warning');
      return;
    }
    void autofocus(autofocusCommand).then((result) => {
      const t = describeAutofocusResult(result);
      pushToast(t.message, t.variant);
    });
  };
}

const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const stopBtnStyle: React.CSSProperties = { background: '#c62828', color: '#fff' };
const progressContainerStyle: React.CSSProperties = {
  position: 'relative',
  background: '#e0e0e0',
  height: 18,
  borderRadius: 3,
  overflow: 'hidden',
};
const progressFillStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  background: '#1976d2',
  transition: 'width 100ms linear',
};
const progressLabelStyle: React.CSSProperties = {
  position: 'relative',
  textAlign: 'center',
  fontSize: 11,
  lineHeight: '18px',
  color: '#111',
  textShadow: '0 0 2px #fff',
};
