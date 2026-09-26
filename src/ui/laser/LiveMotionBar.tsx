import type { StreamerStatus } from '../../core/controllers/grbl';
import { SOFTWARE_ABORT_TITLE } from '../common/software-abort-copy';
import { cncPauseLiftPhase } from '../state/cnc-pause-lift-state';
import { cncResumeAdvisoryNotice } from '../state/cnc-pause-resume-policy';
import { describeControllerOperation } from '../state/laser-controller-operation';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state';
import { describeStreamHold, streamHoldHeading, type StreamHold } from '../state/laser-stream-hold';
import { isActiveJobStatus, toolChangeContinueBlockMessage } from '../state/laser-store-helpers';
import {
  streamProgressPercent,
  useLiveStreamProgress,
  type LiveStreamProgress,
} from './use-live-stream-progress';
import {
  LiveMotionActionButton,
  LIVE_MOTION_ACTION_BUTTON_STYLE,
  PendingCncLiftAction,
  PendingPauseResumeAction,
} from './LiveMotionActionButton';
import { pauseControlMessage, resumeControlTitle } from './job-control-copy';
import { controllerActionFailureHandler } from './report-controller-action-failure';

const MAXIMUM_STACKING_ORDER = 2_147_483_647;
const TOOL_CHANGE_CONTINUE_TITLE =
  'Lift the re-zeroed bit to safe Z with the spindle off, then spin up and resume';

type LaserSnapshot = ReturnType<typeof useLaserStore.getState>;
type ControllerOperation = NonNullable<LaserSnapshot['controllerOperation']>;
type MotionOperation = NonNullable<LaserSnapshot['motionOperation']>;
type PauseResumeTransition = NonNullable<LaserSnapshot['pauseResumeTransition']>;
type ControllerHold = { readonly state: 'Hold' | 'Door'; readonly doorPin: boolean } | null;

type MotionDescription = {
  readonly heading: string;
  readonly detail: string;
  readonly abortLabel: 'ABORT JOB' | 'ABORT MOTION' | 'LASER OFF';
};

export function LiveMotionBar(): JSX.Element | null {
  // Progress by value and throttled: the streamer object is replaced on every
  // acknowledgement (ADR-333).
  const streamProgress = useLiveStreamProgress();
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  const motionOperation = useLaserStore((state) => state.motionOperation);
  const fireActive = useLaserStore((state) => state.fireActive);
  const pauseResumeTransition = useLaserStore((state) => state.pauseResumeTransition);
  const controllerHold = useLaserStore(selectControllerHold);
  const streamHold = useLaserStore((state) => state.streamHold ?? null);
  const falconAirTimerHint = useStore(
    (state) => state.project.device.machineFamily === 'creality-falcon',
  );
  const stopJob = useLaserStore((state) => state.stopJob);
  const setFireActive = useLaserStore((state) => state.setFireActive);
  const description = describeLiveMotion(
    streamProgress,
    controllerOperation,
    motionOperation,
    fireActive,
    pauseResumeTransition,
    controllerHold,
    streamHold,
    falconAirTimerHint,
  );
  if (description === null) return null;
  const abort = description.abortLabel === 'LASER OFF' ? () => setFireActive(false) : stopJob;
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
        <LiveMotionPrimaryAction status={streamProgress.status} />
        <button
          type="button"
          className="lf-btn lf-btn--danger"
          style={abortButtonStyle}
          title={SOFTWARE_ABORT_TITLE}
          onClick={() => void abort().catch(controllerActionFailureHandler('Abort'))}
        >
          {description.abortLabel}
        </button>
      </div>
    </section>
  );
}

function LiveMotionPrimaryAction({ status }: { readonly status: StreamerStatus | null }) {
  const pauseJob = useLaserStore((state) => state.pauseJob);
  const resumeJob = useLaserStore((state) => state.resumeJob);
  const continueToolChange = useLaserStore((state) => state.continueToolChange);
  const hasRealtimePause = useLaserStore((state) => state.capabilities.realtimePause);
  const streamPauseBeamOff = useLaserStore(
    (state) => state.capabilities.streamPauseBeamOff === true,
  );
  const machineKind = useLaserStore((state) => state.activeJobMachineKind);
  const isControllerRunning = useLaserStore((state) => state.statusReport?.state === 'Run');
  const toolChangeBlockMessage = useLaserStore(toolChangeContinueBlockMessage);
  const laserModeEnabled = useLaserStore((state) => state.controllerSettings?.laserModeEnabled);
  const liftPhase = useLaserStore(cncPauseLiftPhase);
  const resumeAdvisory = cncResumeAdvisoryNotice(machineKind, laserModeEnabled, liftPhase);
  const pauseResumeTransition = useLaserStore((state) => state.pauseResumeTransition);
  if (pauseResumeTransition !== null) {
    return (
      <PendingPauseResumeAction
        action={pauseResumeTransition.action}
        pauseJob={pauseJob}
        resumeJob={resumeJob}
      />
    );
  }
  const canPause = status === 'streaming' || (status === 'done' && isControllerRunning);
  if (canPause) {
    return (
      <LiveMotionActionButton
        label="Pause"
        title={pauseControlMessage(machineKind, hasRealtimePause, streamPauseBeamOff)}
        onClick={pauseJob}
      />
    );
  }
  // A lift exists only for a paused stream; while it moves the bit, only Abort
  // interrupts it (ADR-410).
  const movingLift = liftPhase === 'lifted' ? null : liftPhase;
  if (movingLift !== null) {
    return (
      <PendingCncLiftAction phase={movingLift} title={resumeAdvisory ?? ''} resumeJob={resumeJob} />
    );
  }
  if (status === 'paused') {
    return (
      <LiveMotionActionButton
        label="Resume"
        title={resumeControlTitle(resumeAdvisory, hasRealtimePause, streamPauseBeamOff)}
        onClick={resumeJob}
      />
    );
  }
  if (status === 'tool-change') {
    return (
      <LiveMotionActionButton
        label="Continue"
        title={toolChangeBlockMessage ?? TOOL_CHANGE_CONTINUE_TITLE}
        disabled={toolChangeBlockMessage !== null}
        onClick={continueToolChange}
      />
    );
  }
  return null;
}

// The controller's own hold, as opposed to a host-requested pause. One shared
// constant per state: a fresh object compared unequal on every store write, so
// a held job re-rendered this bar per status poll and per store update.
const CONTROLLER_HOLDS = {
  Hold: { closed: { state: 'Hold', doorPin: false }, open: { state: 'Hold', doorPin: true } },
  Door: { closed: { state: 'Door', doorPin: false }, open: { state: 'Door', doorPin: true } },
} as const satisfies Record<
  'Hold' | 'Door',
  Record<'closed' | 'open', NonNullable<ControllerHold>>
>;

function selectControllerHold(state: LaserSnapshot): ControllerHold {
  const reported = state.statusReport?.state ?? null;
  if (reported !== 'Hold' && reported !== 'Door') return null;
  return CONTROLLER_HOLDS[reported][state.statusReport?.pins?.door === true ? 'open' : 'closed'];
}

function describeLiveMotion(
  streamProgress: LiveStreamProgress,
  controllerOperation: ControllerOperation | null,
  motionOperation: MotionOperation | null,
  fireActive: boolean,
  pauseResumeTransition: PauseResumeTransition | null,
  controllerHold: ControllerHold,
  streamHold: StreamHold | null = null,
  falconAirTimerHint = false,
): MotionDescription | null {
  if (isActiveJobStatus(streamProgress.status)) {
    return describeActiveJob(
      streamProgress,
      pauseResumeTransition,
      controllerHold,
      streamHold,
      falconAirTimerHint,
    );
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
  // A latched momentary Fire keeps the beam on with no motion — the bar must
  // still offer a persistent off control, not only the hold-button's release
  // (AUDIT A6). Fire is Idle-only, so this never shadows a job or operation.
  if (fireActive) {
    return {
      heading: 'LASER FIRING',
      detail: 'Momentary Fire is holding the beam on',
      abortLabel: 'LASER OFF',
    };
  }
  return null;
}

// A hold the controller entered by itself — its own feed-hold input, a lid
// or door switch — stops motion while the host is still streaming happily,
// so the bar said JOB RUNNING over a stopped machine with no reason given
// (ADR-333). A host-requested pause is excluded: that one has its own
// heading and its own Resume control. A controller that is merely not
// acknowledging sent lines is the third, quieter case (ADR-345).
function describeActiveJob(
  streamProgress: LiveStreamProgress,
  pauseResumeTransition: PauseResumeTransition | null,
  controllerHold: ControllerHold,
  streamHold: StreamHold | null,
  falconAirTimerHint: boolean,
): MotionDescription {
  const hostOwned = pauseResumeTransition !== null || isHostPaused(streamProgress);
  const heldReason = hostOwned
    ? null
    : controllerHold !== null
      ? controllerHoldDescription(controllerHold)
      : streamHoldDescription(streamProgress, streamHold, falconAirTimerHint);
  return {
    heading: heldReason?.heading ?? jobHeading(streamProgress.status, pauseResumeTransition),
    detail:
      heldReason === null
        ? jobProgress(streamProgress)
        : `${heldReason.detail} · ${jobProgress(streamProgress)}`,
    abortLabel: 'ABORT JOB',
  };
}

function isHostPaused(streamProgress: LiveStreamProgress): boolean {
  return streamProgress.status === 'paused';
}

// The controller answers status queries but has stopped acknowledging the
// lines already sent: the sender is waiting, not the machine holding on a
// switch. Named with its age so a machine that holds its own program (the
// Creality A1 standby timer) is not read as a frozen app.
function streamHoldDescription(
  streamProgress: LiveStreamProgress,
  streamHold: StreamHold | null,
  falconAirTimerHint: boolean,
): { readonly heading: string; readonly detail: string } | null {
  if (streamHold === null || streamProgress.status !== 'streaming') return null;
  return {
    heading: streamHoldHeading(streamHold),
    detail: describeStreamHold(streamHold, falconAirTimerHint),
  };
}

// Deliberately no Resume button here. Releasing a controller-owned hold is the
// machine's own cycle-start, and the app's Resume path carries the ADR-180
// accessory-state proof a hold the app never requested has not established.
// Naming the state and what releases it is the whole fix.
function controllerHoldDescription(hold: NonNullable<ControllerHold>): {
  readonly heading: string;
  readonly detail: string;
} {
  if (hold.state === 'Door') {
    return {
      heading: 'CONTROLLER DOOR HOLD',
      detail: hold.doorPin
        ? 'The controller reports its door or lid input open and has stopped motion. Close it, then press cycle start on the machine'
        : 'The controller is in its door-safety state and has stopped motion. Release it with cycle start on the machine',
    };
  }
  return {
    heading: 'CONTROLLER HOLD',
    detail:
      'The controller is holding motion on its own feed hold, not a pause from here. Release it with cycle start on the machine',
  };
}

function jobHeading(
  status: StreamerStatus | null,
  pauseResumeTransition: PauseResumeTransition | null,
): string {
  if (pauseResumeTransition?.action === 'pause') return 'JOB PAUSING';
  if (pauseResumeTransition?.action === 'resume') return 'JOB RESUMING';
  if (status === 'streaming') return 'JOB RUNNING';
  if (status === 'paused') return 'JOB PAUSED';
  if (status === 'tool-change') return 'TOOL CHANGE';
  if (status === 'errored') return 'JOB NEEDS ATTENTION';
  return 'MACHINE FINISHING';
}

function jobProgress(streamProgress: LiveStreamProgress): string {
  if (streamProgress.total <= 0) return 'Preparing controller stream';
  return `${streamProgress.completed} / ${streamProgress.total} lines · ${streamProgressPercent(streamProgress)}%`;
}

// Overlaid on the canvas's lower edge (ADR-207 amendment, 2026-09-19). In
// normal flow between the workspace and the status bar, every jog, auto-focus,
// or job starting and settling resized the canvas — the whole screen jumped.
// Absolutely positioned inside the canvas area it takes no layout space and
// can only ever cover drawing surface, never a rail or tool-strip control.
// A floating popup, not a bar (maintainer, 2026-09-20: "above screen like a
// pop up that doesnt affect the rest and wont cause any jumping").
// `position: fixed` takes it out of flow entirely and out of every ancestor's
// box, so nothing it does can resize the workspace, move the rails, or be
// clipped by the canvas's overflow — mounting and unmounting it on each jog,
// auto-focus and job cannot shift a single pixel of the app. It is sized by
// its content rather than the window, so it covers a small patch above the
// status bar instead of a full-bleed strip across the workspace.
const barStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 34,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: MAXIMUM_STACKING_ORDER,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px 16px',
  width: 'max-content',
  // Capped so a wide window gets a popup rather than a 75%-width strip: the
  // safety note wraps under the heading and the card keeps its 48 px-control
  // height either way.
  maxWidth: 'min(720px, calc(100vw - 24px))',
  boxSizing: 'border-box',
  padding: '8px 14px',
  background: 'var(--lf-bg-1)',
  border: '1px solid var(--lf-border)',
  borderTop: '3px solid var(--lf-danger)',
  borderRadius: 'var(--lf-radius-lg)',
  boxShadow: 'var(--lf-shadow)',
};
// One wrapping line — heading · detail · safety note — so the bar is no taller
// than its 48 px controls instead of stacking a second text row beside them.
const statusStyle: React.CSSProperties = {
  display: 'flex',
  flex: '1 1 280px',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '2px 12px',
  minWidth: 0,
};
const statusLineStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '2px 10px',
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
const abortButtonStyle: React.CSSProperties = {
  ...LIVE_MOTION_ACTION_BUTTON_STYLE,
  minWidth: 144,
  fontWeight: 800,
  letterSpacing: 0.4,
};
