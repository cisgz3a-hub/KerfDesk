import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { RELEASE_MOTORS_CONFIRM } from './hand-position-copy';

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
  readonly onUseCurrent: () => void;
  readonly onRelease: () => void;
  readonly onUseHandPosition: () => void;
  readonly onUnlock: () => void;
};

export function NoHomingPositionGuide(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
}): JSX.Element | null {
  const homingEnabled = useStore((state) => state.project.device.homing.enabled);
  const connection = useLaserStore((state) => state.connection);
  const status = useLaserStore((state) => state.statusReport?.state ?? null);
  const canSleep = useLaserStore((state) => state.capabilities.sleep);
  const canUnlock = useLaserStore((state) => state.capabilities.unlock);
  const actions = useGuideActions(connection.kind === 'connected', status);
  if (homingEnabled) return null;
  const phase = status === 'Sleep' && actions.phase === 'idle' ? 'positioning' : actions.phase;
  const normalBusy = props.disabled || props.streaming || status !== 'Idle';
  return (
    <section aria-label="Position job" style={guideStyle}>
      <strong>Position job</strong>
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

function useGuideActions(connected: boolean, status: string | null): GuideActions {
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
    onUseCurrent: () => {
      setJobPlacement({ startFrom: 'current-position' });
      setPhase('idle');
      setError(null);
      pushToast('Current Position selected. Jog, Frame, then Start.', 'success');
    },
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
    <IdleStep
      disabled={props.normalBusy || props.phase === 'releasing'}
      canSleep={props.canSleep}
      error={props.actions.error}
      releasing={props.phase === 'releasing'}
      onUseCurrent={props.actions.onUseCurrent}
      onRelease={props.actions.onRelease}
    />
  );
}

function IdleStep(props: {
  readonly disabled: boolean;
  readonly canSleep: boolean;
  readonly error: string | null;
  readonly releasing: boolean;
  readonly onUseCurrent: () => void;
  readonly onRelease: () => void;
}): JSX.Element {
  return (
    <>
      <p style={messageStyle}>
        Jog with the arrows, then Frame and Start. Set origin is not required.
      </p>
      <div style={buttonRowStyle}>
        <button
          type="button"
          disabled={props.disabled}
          onClick={props.onUseCurrent}
          title="Use the live head position; then Frame before Start."
        >
          Use current head position
        </button>
        <button
          type="button"
          disabled={props.disabled || !props.canSleep}
          onClick={props.onRelease}
          title={
            props.canSleep
              ? 'Release motors for hand positioning.'
              : 'Controller has no sleep command.'
          }
        >
          {props.releasing ? 'Releasing motors...' : 'Move head by hand'}
        </button>
      </div>
      {props.error !== null && <p style={errorStyle}>{props.error}</p>}
    </>
  );
}

function PositioningStep(props: {
  readonly controllerSleeping: boolean;
  readonly onUseHandPosition: () => void;
}): JSX.Element {
  return (
    <>
      <p style={messageStyle}>Motors are released. Move the head to the job anchor.</p>
      <button
        type="button"
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

const guideStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
  background: 'var(--lf-bg-1)',
};
const messageStyle: React.CSSProperties = { margin: '4px 0 6px', fontSize: 12 };
const errorStyle: React.CSSProperties = { ...messageStyle, color: 'var(--lf-danger-fg)' };
const buttonRowStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
