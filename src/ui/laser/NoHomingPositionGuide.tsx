import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { hasCustomOrigin, useLaserStore } from '../state/laser-store';
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
  const canSleep = useLaserStore((state) => state.capabilities.sleep);
  const canUnlock = useLaserStore((state) => state.capabilities.unlock);
  const workOriginActive = useLaserStore((state) => state.workOriginActive);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const originSettled = workOriginActive || hasCustomOrigin(wcoCache);
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
        canSleep={canSleep}
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
        .then(() => finishHandPosition({ setOriginHere, setJobPlacement }))
        .then(() => {
          setPhase('ready');
          pushToast('Hand position is ready. Frame the job before Start.', 'success');
        })
        .catch((cause: unknown) => {
          if (useLaserStore.getState().statusReport?.state === 'Alarm') {
            setPhase('alarmed');
            setError(null);
            return;
          }
          fail(cause);
        });
    },
    onUnlock: () => {
      setPhase('waiting-idle');
      setError(null);
      void unlockAlarm().catch(fail);
    },
  };
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
  readonly canSleep: boolean;
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
      canSleep={props.canSleep}
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
  readonly onUnlock: () => void;
}): JSX.Element {
  if (props.phase === 'alarmed') {
    return (
      <>
        <p style={messageStyle}>GRBL is awake but locked. Confirm the head is safely positioned.</p>
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
