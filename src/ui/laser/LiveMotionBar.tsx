import { useRef } from 'react';
import type { StreamerStatus } from '../../core/controllers/grbl';
import { airStandbyRemedy, type AirStandbyRemedy } from '../../core/devices/air-standby-remedy';
import { machineKindOf, type MachineKind } from '../../core/scene';
import { MODAL_REACHABLE_ATTRIBUTE } from '../common/hide-outside-modal';
import {
  cncJobLaserModeEnabled,
  cncPauseControllerKind,
  cncPauseLiftPhase,
  cncPauseLiftSkipReason,
} from '../state/cnc-pause-lift-state';
import { cncResumeAdvisoryNotice } from '../state/cnc-pause-resume-policy';
import { describeControllerOperation } from '../state/laser-controller-operation';
import { laserDotLit } from '../state/laser-dot-light';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useStore } from '../state';
import { describeStreamHold, streamHoldHeading, type StreamHold } from '../state/laser-stream-hold';
import { isActiveJobStatus, toolChangeContinueBlockMessage } from '../state/laser-store-helpers';
import {
  unownedControllerMotion,
  type UnownedControllerMotion,
} from '../state/unowned-controller-motion';
import {
  turnUnownedOutputOff,
  unownedControllerOutput,
  type UnownedControllerOutput,
} from '../state/unowned-controller-output';
import {
  streamProgressPercent,
  useLiveStreamProgress,
  type LiveStreamProgress,
} from './use-live-stream-progress';
import {
  LiveMotionActionButton,
  pendingCncLiftButton,
  pendingPauseResumeButton,
} from './LiveMotionActionButton';
import { pauseControlMessage, resumeControlTitle } from './job-control-copy';
import { describeUnowned } from './live-motion-unowned';
import { LiveMotionAnnouncer, shownForAnnouncer } from './LiveMotionAnnouncer';
import { LiveMotionAbortButton } from './LiveMotionAbortButton';
import { useJobStartFocus } from './use-job-start-focus';

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
  /** What a screen reader hears with a job's heading: why it is held. */
  readonly heldDetail?: string;
};

export function LiveMotionBar(): JSX.Element | null {
  // Progress by value and throttled: the streamer object is replaced on every
  // acknowledgement (ADR-333).
  const streamProgress = useLiveStreamProgress();
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  const motionOperation = useLaserStore((state) => state.motionOperation);
  const fire = useLaserStore(fireLatch);
  const pauseResumeTransition = useLaserStore((state) => state.pauseResumeTransition);
  const controllerHold = useLaserStore(selectControllerHold);
  const streamHold = useLaserStore((state) => state.streamHold ?? null);
  const unownedMotion = useLaserStore(unownedControllerMotion);
  const machineKind = useStore((state) => machineKindOf(state.project.machine));
  const unownedOutput = useLaserStore((state) => unownedControllerOutput(state, machineKind));
  const homingStateStuck = useLaserStore((state) => state.resetRequired === 'homing-state');
  const falconAirTimerHint = useStore((state) =>
    state.project.device.machineFamily === 'creality-falcon'
      ? airStandbyRemedy(state.project.device)
      : null,
  );
  const stopJob = useLaserStore((state) => state.stopJob);
  const setFireActive = useLaserStore((state) => state.setFireActive);
  const description = describeLiveMotion(
    streamProgress,
    controllerOperation,
    motionOperation,
    fire,
    pauseResumeTransition,
    controllerHold,
    streamHold,
    falconAirTimerHint,
    unownedMotion,
    homingStateStuck,
    unownedOutput,
  );
  const barRef = useRef<HTMLElement>(null);
  useJobStartFocus(barRef, description?.abortLabel === 'ABORT JOB');
  const announcer = (
    <LiveMotionAnnouncer shown={shownForAnnouncer(description)} progress={streamProgress} />
  );
  if (description === null) return announcer;
  const abort =
    description.abortLabel === 'LASER OFF'
      ? () => laserOff(fire !== null, setFireActive, machineKind)
      : stopJob;
  // Not a live region: the line count changes up to every 120 ms. The
  // announcer speaks the changes of state (UX audit U7-P2-1). The bar stays
  // exposed to assistive technology behind an open modal.
  return (
    <>
      {announcer}
      <section
        ref={barRef}
        aria-label="Live Motion"
        style={barStyle}
        {...{ [MODAL_REACHABLE_ATTRIBUTE]: '' }}
      >
        <div style={statusStyle}>
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
          <LiveMotionAbortButton label={description.abortLabel} abort={abort} />
        </div>
      </section>
    </>
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
  const laserModeEnabled = useLaserStore(cncJobLaserModeEnabled);
  const liftPhase = useLaserStore(cncPauseLiftPhase);
  const liftSkipReason = useLaserStore(cncPauseLiftSkipReason);
  const controllerKind = useLaserStore(cncPauseControllerKind);
  const resumeAdvisory = cncResumeAdvisoryNotice(
    machineKind,
    laserModeEnabled,
    liftPhase,
    liftSkipReason,
    controllerKind,
  );
  const pauseResumeTransition = useLaserStore((state) => state.pauseResumeTransition);
  if (pauseResumeTransition !== null) {
    const pending = { action: pauseResumeTransition.action, pauseJob, resumeJob };
    return <LiveMotionActionButton {...pendingPauseResumeButton(pending)} />;
  }
  const canPause = status === 'streaming' || (status === 'done' && isControllerRunning);
  if (canPause) {
    return (
      <LiveMotionActionButton
        label="Pause"
        title={pauseControlMessage(
          machineKind,
          hasRealtimePause,
          streamPauseBeamOff,
          controllerKind,
        )}
        onClick={pauseJob}
      />
    );
  }
  // A lift exists only for a paused stream; while it moves the bit, only Abort
  // interrupts it (ADR-411).
  const movingLift = liftPhase === 'lifted' ? null : liftPhase;
  if (movingLift !== null) {
    const lift = { phase: movingLift, title: resumeAdvisory ?? '', resumeJob };
    return <LiveMotionActionButton {...pendingCncLiftButton(lift)} />;
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
  fire: FireLatch | null,
  pauseResumeTransition: PauseResumeTransition | null,
  controllerHold: ControllerHold,
  streamHold: StreamHold | null = null,
  falconAirTimerHint: AirStandbyRemedy | null = null,
  unownedMotion: UnownedControllerMotion | null = null,
  homingStateStuck = false,
  unownedOutput: UnownedControllerOutput | null = null,
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
  if (fire !== null) {
    return {
      heading: 'LASER FIRING',
      detail:
        fire === 'laser-dot'
          ? 'The laser dot is on at low power to show where it will burn'
          : 'Momentary Fire is holding the beam on',
      abortLabel: 'LASER OFF',
    };
  }
  // Motion the controller reports and nothing here owns, such as a Console
  // G1, $J= or $H: Disconnect used to be its only stop (ADR-375 C-2). Then a
  // laser it reports on at Idle, such as after a Console M3 (J2-P2-1).
  return describeUnowned(unownedMotion, unownedOutput, controllerHold, homingStateStuck);
}

// LASER OFF puts out a latched Fire, or else the laser the controller reports
// on with no owner here, read at the click.
function laserOff(
  fireLatched: boolean,
  setFireActive: LaserState['setFireActive'],
  machineKind: MachineKind,
): Promise<void> {
  return fireLatched
    ? setFireActive(false)
    : turnUnownedOutputOff(useLaserStore.getState(), machineKind);
}

type FireLatch = 'momentary' | 'laser-dot';

// The Falcon's LED holds the Fire latch too (ADR-664); say which beam is on.
function fireLatch(state: LaserState): FireLatch | null {
  if (!state.fireActive) return null;
  return laserDotLit(state) ? 'laser-dot' : 'momentary';
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
  falconAirTimerHint: AirStandbyRemedy | null,
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
    ...(heldReason === null ? {} : { heldDetail: heldReason.detail }),
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
  falconAirTimerHint: AirStandbyRemedy | null,
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
// Naming the state and what releases it is the whole fix. Most hobby lasers
// have no cycle-start button, so a door hold also names the route that works
// here: Pause makes the hold the app's own, and its Resume then releases it
// (UX audit U4-P3-2, U5-P3-5).
function controllerHoldDescription(hold: NonNullable<ControllerHold>): {
  readonly heading: string;
  readonly detail: string;
} {
  if (hold.state === 'Door') {
    return {
      heading: 'CONTROLLER DOOR HOLD',
      detail: hold.doorPin
        ? `The lid or door is open, so the controller stopped the job. Close it, then ${DOOR_RELEASE}`
        : `The lid or door was opened, so the controller stopped the job. ${capitalised(DOOR_RELEASE)}`,
    };
  }
  return {
    heading: 'CONTROLLER HOLD',
    detail:
      'The controller is holding motion on its own feed hold, not a pause from here. Release it with cycle start on the machine',
  };
}

const DOOR_RELEASE =
  "press Pause and then Resume here, or the machine's cycle-start button if it has one";

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
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
