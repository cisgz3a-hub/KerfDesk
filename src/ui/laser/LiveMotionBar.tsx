import { progress } from '../../core/controllers/grbl';
import { SOFTWARE_ABORT_TITLE } from '../common/software-abort-copy';
import { cncResumeBlockMessage } from '../state/cnc-pause-resume-policy';
import { describeControllerOperation } from '../state/laser-controller-operation';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob, toolChangeContinueBlockMessage } from '../state/laser-store-helpers';
import { pauseControlMessage, resumeControlTitle } from './job-control-copy';

const MAXIMUM_STACKING_ORDER = 2_147_483_647;
const TOOL_CHANGE_CONTINUE_TITLE =
  'Lift the re-zeroed bit to safe Z with the spindle off, then spin up and resume';

type LaserSnapshot = ReturnType<typeof useLaserStore.getState>;
type Streamer = NonNullable<LaserSnapshot['streamer']>;
type ControllerOperation = NonNullable<LaserSnapshot['controllerOperation']>;
type MotionOperation = NonNullable<LaserSnapshot['motionOperation']>;

type MotionDescription = {
  readonly heading: string;
  readonly detail: string;
  readonly abortLabel: 'ABORT JOB' | 'ABORT MOTION';
};

export function LiveMotionBar(): JSX.Element | null {
  const streamer = useLaserStore((state) => state.streamer);
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  const motionOperation = useLaserStore((state) => state.motionOperation);
  const stopJob = useLaserStore((state) => state.stopJob);
  const description = describeLiveMotion(streamer, controllerOperation, motionOperation);
  if (description === null) return null;
  return (
    <section aria-label="Live Motion" style={barStyle}>
      <div style={statusStyle} aria-live="polite">
        <div style={statusLineStyle}>
          <strong style={headingStyle}>{description.heading}</strong>
          <span style={detailStyle}>{description.detail}</span>
        </div>
        <span style={safetyStyle}>
          Software controller stop — use the physical E-stop or power isolation for danger.
        </span>
      </div>
      <div role="group" aria-label="Live machine controls" style={actionsStyle}>
        <LiveMotionPrimaryAction streamer={streamer} />
        <button
          type="button"
          className="lf-btn lf-btn--danger"
          style={abortButtonStyle}
          title={SOFTWARE_ABORT_TITLE}
          onClick={() => void stopJob().catch(() => undefined)}
        >
          {description.abortLabel}
        </button>
      </div>
    </section>
  );
}

function LiveMotionPrimaryAction({ streamer }: { readonly streamer: Streamer | null }) {
  const pauseJob = useLaserStore((state) => state.pauseJob);
  const resumeJob = useLaserStore((state) => state.resumeJob);
  const continueToolChange = useLaserStore((state) => state.continueToolChange);
  const hasRealtimePause = useLaserStore((state) => state.capabilities.realtimePause);
  const machineKind = useLaserStore((state) => state.activeJobMachineKind);
  const isControllerRunning = useLaserStore((state) => state.statusReport?.state === 'Run');
  const toolChangeBlockMessage = useLaserStore(toolChangeContinueBlockMessage);
  const resumeBlockMessage = cncResumeBlockMessage(machineKind);
  const canPause =
    streamer?.status === 'streaming' || (streamer?.status === 'done' && isControllerRunning);
  if (canPause) {
    return (
      <ActionButton
        label="Pause"
        title={pauseControlMessage(machineKind, hasRealtimePause)}
        onClick={pauseJob}
      />
    );
  }
  if (streamer?.status === 'paused') {
    return (
      <ActionButton
        label="Resume"
        title={resumeControlTitle(resumeBlockMessage, hasRealtimePause)}
        disabled={resumeBlockMessage !== null}
        onClick={resumeJob}
      />
    );
  }
  if (streamer?.status === 'tool-change') {
    return (
      <ActionButton
        label="Continue"
        title={toolChangeBlockMessage ?? TOOL_CHANGE_CONTINUE_TITLE}
        disabled={toolChangeBlockMessage !== null}
        onClick={continueToolChange}
      />
    );
  }
  return null;
}

function ActionButton(props: {
  readonly label: string;
  readonly title: string;
  readonly disabled?: boolean;
  readonly onClick: () => Promise<void>;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      style={actionButtonStyle}
      title={props.title}
      disabled={props.disabled}
      onClick={() => void props.onClick().catch(() => undefined)}
    >
      {props.label}
    </button>
  );
}

function describeLiveMotion(
  streamer: Streamer | null,
  controllerOperation: ControllerOperation | null,
  motionOperation: MotionOperation | null,
): MotionDescription | null {
  if (streamer !== null && isActiveJob(streamer)) {
    return {
      heading: jobHeading(streamer.status),
      detail: jobProgress(streamer),
      abortLabel: 'ABORT JOB',
    };
  }
  if (controllerOperation !== null) {
    return {
      heading: 'MACHINE OPERATION',
      detail: describeControllerOperation(controllerOperation),
      abortLabel: 'ABORT MOTION',
    };
  }
  if (motionOperation !== null) {
    const noun = motionOperation.kind === 'frame' ? 'FRAMING' : 'JOGGING';
    return { heading: noun, detail: 'Controller motion is active', abortLabel: 'ABORT MOTION' };
  }
  return null;
}

function jobHeading(status: Streamer['status']): string {
  if (status === 'streaming') return 'JOB RUNNING';
  if (status === 'paused') return 'JOB PAUSED';
  if (status === 'tool-change') return 'TOOL CHANGE';
  if (status === 'errored') return 'JOB NEEDS ATTENTION';
  return 'MACHINE FINISHING';
}

function jobProgress(streamer: Streamer): string {
  if (streamer.total <= 0) return 'Preparing controller stream';
  const percent = streamer.status === 'done' ? 99 : Math.round(progress(streamer) * 100);
  return `${streamer.completed} / ${streamer.total} lines · ${percent}%`;
}

const barStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: MAXIMUM_STACKING_ORDER,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '10px 18px',
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '10px 16px',
  flexShrink: 0,
  background: 'var(--lf-bg-1)',
  borderTop: '1px solid var(--lf-border)',
  borderBottom: '3px solid var(--lf-danger)',
  boxShadow: 'var(--lf-shadow)',
};
const statusStyle: React.CSSProperties = {
  display: 'flex',
  flex: '1 1 280px',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
};
const statusLineStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '4px 12px',
};
const headingStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)', fontSize: 15 };
const detailStyle: React.CSSProperties = {
  color: 'var(--lf-text)',
  fontVariantNumeric: 'tabular-nums',
};
const safetyStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flex: '0 0 auto',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 12,
  marginLeft: 'auto',
};
const actionButtonStyle: React.CSSProperties = {
  minWidth: 128,
  minHeight: 48,
  fontSize: 16,
  fontWeight: 700,
};
const abortButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  minWidth: 144,
  fontWeight: 800,
  letterSpacing: 0.4,
};
