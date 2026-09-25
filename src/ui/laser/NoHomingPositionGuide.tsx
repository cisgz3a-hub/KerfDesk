import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { hasCustomXyOrigin, useLaserStore } from '../state/laser-store';
import { sleepUnavailableReason } from '../state/controller-sleep';
import { useToastStore } from '../state/toast-store';
import { RELEASE_MOTORS_CONFIRM } from './hand-position-copy';
import { sectionCaptionStyle } from './JobControls.styles';
import { NoHomingPositionChoices } from './NoHomingPositionChoices';

type GuidePhase =
  | 'idle'
  | 'releasing'
  | 'positioning'
  | 'waking'
  | 'alarmed'
  | 'waiting-idle'
  | 'setting-origin'
  | 'ready'
  | 'failed';

type GuideActions = {
  readonly phase: GuidePhase;
  readonly error: string | null;
  readonly onRelease: () => void;
  readonly onUseHandPosition: () => void;
  readonly onUnlock: () => void;
};

// Phases whose feedback must survive an active origin: 'releasing' runs before
// the $SLP ack clears the origin, and the wake/unlock chain must never strand
// the operator mid-recovery.
const ORIGIN_TRANSACTION_PHASES: ReadonlyArray<GuidePhase> = [
  'releasing',
  'waking',
  'alarmed',
  'waiting-idle',
  'setting-origin',
];

export function NoHomingPositionGuide(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
}): JSX.Element | null {
  const homingEnabled = useStore((state) => state.project.device.homing.enabled);
  const connection = useLaserStore((state) => state.connection);
  const status = useLaserStore((state) => state.statusReport?.state ?? null);
  const sleepBlockedReason = useLaserStore(sleepUnavailableReason);
  const canUnlock = useLaserStore((state) => state.capabilities.unlock);
  const workOriginActive = useLaserStore((state) => state.workOriginActive);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  // XY predicate on purpose: a CNC Zero Z touch-off is a Z-only offset that
  // placement does not count as an origin, so the card must keep coaching.
  const originSettled = workOriginActive || hasCustomXyOrigin(wcoCache);
  const actions = useGuideActions(connection.kind === 'connected', status, originSettled);
  if (homingEnabled) return null;
  const phase = status === 'Sleep' && actions.phase === 'idle' ? 'positioning' : actions.phase;
  // A custom work origin means positioning is already settled — Set origin
  // here is the flow's whole destination, so the card leaves the rail the
  // moment one exists (however it was set) and returns when the origin is
  // cleared. Releasing motors and Sleep both clear the origin in the store,
  // so a genuine hand-position run is never hidden by this.
  if (originSettled && !ORIGIN_TRANSACTION_PHASES.includes(phase)) return null;
  const normalBusy = props.disabled || props.streaming || status !== 'Idle';
  return (
    <section aria-label="Position job" style={guideStyle}>
      <strong style={guideCaptionStyle}>Position job</strong>
      <GuideBody
        actions={actions}
        phase={phase}
        status={status}
        normalBusy={normalBusy}
        sleepBlockedReason={sleepBlockedReason}
        canUnlock={canUnlock}
      />
    </section>
  );
}

function useGuideActions(
  connected: boolean,
  status: string | null,
  originSettled: boolean,
): GuideActions {
  const [phase, setPhase] = useState<GuidePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const setJobPlacement = useStore((state) => state.setJobPlacement);
  const releaseMotors = useLaserStore((state) => state.releaseMotors);
  const wakeController = useLaserStore((state) => state.wakeController);
  const unlockAlarm = useLaserStore((state) => state.unlockAlarm);
  const setOriginHere = useLaserStore((state) => state.setOriginHere);
  const pushToast = useToastStore((state) => state.pushToast);
  const fail = useCallback(
    (cause: unknown): void => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setPhase('failed');
      pushToast(`Positioning failed: ${message}`, 'warning');
    },
    [pushToast],
  );
  useEffect(() => {
    if (!connected) {
      setPhase('idle');
      setError(null);
    }
  }, [connected]);
  // An origin set outside a live transaction (Set origin here, or the flow's
  // own completion) makes any parked step stale — 'positioning' would keep
  // claiming released motors after the operator woke the controller
  // elsewhere, and 'ready'/'failed' would resurface out of context after a
  // later Reset origin. Park back at idle so the card re-opens fresh.
  useEffect(() => {
    if (!originSettled) return;
    if (phase !== 'positioning' && phase !== 'ready' && phase !== 'failed') return;
    setPhase('idle');
    setError(null);
  }, [originSettled, phase]);
  useUnlockIdleDeadline(phase, setPhase, setError);
  useEffect(() => {
    if (phase !== 'waiting-idle' || status !== 'Idle') return;
    setPhase('setting-origin');
    void finishHandPosition({ setOriginHere, setJobPlacement })
      .then(() => {
        setPhase('ready');
        pushToast('Hand position is ready. Frame the job before Start.', 'success');
      })
      .catch(fail);
  }, [fail, phase, pushToast, setJobPlacement, setOriginHere, status]);
  return {
    phase,
    error,
    onRelease: () => {
      if (!jobAwareConfirm(RELEASE_MOTORS_CONFIRM)) return;
      setPhase('releasing');
      setError(null);
      void releaseMotors()
        .then(() => setPhase('positioning'))
        .catch(fail);
    },
    onUseHandPosition: () => {
      setPhase('waking');
      setError(null);
      void wakeController()
        .then(async (outcome) => {
          if (outcome === 'alarm') return setPhase('alarmed');
          await finishHandPosition({ setOriginHere, setJobPlacement });
          setPhase('ready');
          pushToast('Hand position is ready. Frame the job before Start.', 'success');
        })
        .catch((cause: unknown) => wakeFailed(cause, setPhase, setError, fail));
    },
    onUnlock: () => unlockAndWait(unlockAlarm, setPhase, setError),
  };
}

// GRBL, grblHAL and FluidNC come back from the reset locked in Alarm by design:
// the wake resolves 'alarm' and the guide offers Unlock instead of setting an
// origin on a locked controller (controller audit 2026-09-25 HF-5). A failed
// wake that still left the controller in Alarm is handled the same way.
function wakeFailed(
  cause: unknown,
  setPhase: (phase: GuidePhase) => void,
  setError: (error: string | null) => void,
  fail: (cause: unknown) => void,
): void {
  if (useLaserStore.getState().statusReport?.state === 'Alarm') {
    setPhase('alarmed');
    setError(null);
    return;
  }
  fail(cause);
}

const UNLOCK_IDLE_WAIT_MS = 5_000;

// A refused unlock leaves the controller locked: offer Unlock again.
function unlockAndWait(
  unlockAlarm: () => Promise<void>,
  setPhase: (phase: GuidePhase) => void,
  setError: (error: string | null) => void,
): void {
  setPhase('waiting-idle');
  setError(null);
  void unlockAlarm().catch((cause: unknown) => {
    setPhase('alarmed');
    setError(`Unlock failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  });
}

// An unlock the controller acknowledged but did not honour (a limit switch
// still pressed) keeps it in Alarm. The card used to wait for Idle with no
// deadline and no way back; after a bounded wait it offers Unlock again with
// the state the controller reports (controller audit gap-start-11).
function useUnlockIdleDeadline(
  phase: GuidePhase,
  setPhase: (phase: GuidePhase) => void,
  setError: (error: string | null) => void,
): void {
  useEffect(() => {
    if (phase !== 'waiting-idle') return;
    const timer = setTimeout(() => {
      const reported = useLaserStore.getState().statusReport?.state ?? 'no status';
      setPhase('alarmed');
      setError(
        `The controller did not report Idle after Unlock; it reports ${reported}. Check the limit switches and the door, then unlock again.`,
      );
    }, UNLOCK_IDLE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [phase, setError, setPhase]);
}

async function finishHandPosition(args: {
  readonly setOriginHere: () => Promise<void>;
  readonly setJobPlacement: (patch: { readonly startFrom: 'verified-origin' }) => void;
}): Promise<void> {
  await args.setOriginHere();
  args.setJobPlacement({ startFrom: 'verified-origin' });
}

function GuideBody(props: {
  readonly actions: GuideActions;
  readonly phase: GuidePhase;
  readonly status: string | null;
  readonly normalBusy: boolean;
  readonly sleepBlockedReason: string | null;
  readonly canUnlock: boolean;
}): JSX.Element {
  if (props.phase === 'positioning') {
    return (
      <PositioningStep
        controllerSleeping={props.status === 'Sleep'}
        onUseHandPosition={props.actions.onUseHandPosition}
      />
    );
  }
  if (
    props.phase === 'waking' ||
    props.phase === 'alarmed' ||
    props.phase === 'waiting-idle' ||
    props.phase === 'setting-origin'
  ) {
    return (
      <RecoveringStep
        phase={props.phase}
        canUnlock={props.canUnlock}
        error={props.actions.error}
        onUnlock={props.actions.onUnlock}
      />
    );
  }
  if (props.phase === 'ready') {
    return <p style={messageStyle}>Hand position ready. Frame must succeed before Start.</p>;
  }
  return (
    <NoHomingPositionChoices
      disabled={props.normalBusy || props.phase === 'releasing'}
      sleepBlockedReason={props.sleepBlockedReason}
      error={props.actions.error}
      releasing={props.phase === 'releasing'}
      onRelease={props.actions.onRelease}
    />
  );
}

function PositioningStep(props: {
  readonly controllerSleeping: boolean;
  readonly onUseHandPosition: () => void;
}): JSX.Element {
  return (
    <>
      <p style={messageStyle}>
        Motors are released. Move the head to the job anchor, then confirm its position.
      </p>
      <button
        type="button"
        className="lf-btn"
        style={guideButtonStyle}
        disabled={!props.controllerSleeping}
        onClick={props.onUseHandPosition}
        title="Wake the controller, set this position as origin, then require a Frame."
      >
        {props.controllerSleeping ? 'Use this position' : 'Waiting for Sleep...'}
      </button>
    </>
  );
}

function RecoveringStep(props: {
  readonly phase: 'waking' | 'alarmed' | 'waiting-idle' | 'setting-origin';
  readonly canUnlock: boolean;
  readonly error: string | null;
  readonly onUnlock: () => void;
}): JSX.Element {
  if (props.phase === 'alarmed') {
    return (
      <>
        <p style={messageStyle}>GRBL is awake but locked. Confirm the head is safely positioned.</p>
        {props.error !== null && <p style={errorStyle}>{props.error}</p>}
        <button
          type="button"
          className="lf-btn"
          style={guideButtonStyle}
          disabled={!props.canUnlock}
          onClick={props.onUnlock}
          title="Unlock only after confirming the hand-positioned head is safe."
        >
          Unlock and continue
        </button>
      </>
    );
  }
  if (props.phase === 'waiting-idle') {
    return <p style={messageStyle}>Unlock sent. Waiting for the controller to report Idle...</p>;
  }
  if (props.phase === 'setting-origin') {
    return <p style={messageStyle}>Controller is Idle. Setting the new origin...</p>;
  }
  return <p style={messageStyle}>Waking controller...</p>;
}

// One bordered card for the whole flow — the previous box-in-a-box nesting
// (guide border + inner method border) fragmented a narrow rail into slivers.
const guideStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
  background: 'var(--lf-bg-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
// Shared caption, darkened one step: faint text on this card's tinted
// background loses too much contrast at 11px.
const guideCaptionStyle: React.CSSProperties = {
  ...sectionCaptionStyle,
  color: 'var(--lf-text-muted)',
};
const guideButtonStyle: React.CSSProperties = { width: '100%' };
const messageStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const errorStyle: React.CSSProperties = { ...messageStyle, color: 'var(--lf-danger-fg)' };
