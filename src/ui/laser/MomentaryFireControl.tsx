// MomentaryFireControl — the hold-to-fire positioning beam in Position the
// head (ADR-162, amended by ADR-387). Shown on every laser project: a machine
// without the opt-in gets a Set up button, and a refused press names its
// reason on the button face instead of the control vanishing. The power reads
// as both the percent and the S word a press sends.

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
// Deep import: the devices barrel is at its public-export ratchet.
import { formatFirePercent } from '../../core/devices/fire-availability';
import {
  fireActivationBlock,
  fireSetupForProject,
  type FireSetup,
} from '../state/laser-fire-readiness';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useStore } from '../state/store';
import { openMachineSetup } from './device-setup';
import { controllerActionFailureHandler } from './report-controller-action-failure';

type EnabledFireSetup = Extract<FireSetup, { readonly kind: 'enabled' }>;
type UnreadyFireSetup = Extract<FireSetup, { readonly kind: 'unavailable' | 'needs-setup' }>;

export function MomentaryFireControl(): JSX.Element | null {
  const project = useStore((state) => state.project);
  // Only what this control reads, never the whole store: it is always mounted
  // in the jog pad, and a whole-store subscription re-rendered it on every
  // acknowledged line of a running job. The refusal is selected as text, so a
  // write that leaves it unchanged does not render the control.
  const fireActive = useLaserStore((state) => state.fireActive);
  const setFireActive = useLaserStore((state) => state.setFireActive);
  const blockMessage = useLaserStore(
    (state) => fireActivationBlock(state, project)?.message ?? null,
  );
  const blockCaption = useLaserStore(
    (state) => fireActivationBlock(state, project)?.caption ?? null,
  );
  const setup = fireSetupForProject(project);
  const control = setup.kind === 'enabled' ? setup.control : null;
  const { held, release } = useMomentaryRelease(setFireActive);

  useEffect(() => {
    if (control === null) release();
  }, [control, release]);
  if (setup.kind === 'hidden') return null;
  if (setup.kind !== 'enabled') return <FireSetupButton setup={setup} />;

  const press = (): void => {
    if (blockMessage !== null || held.current) return;
    held.current = true;
    void setFireActive(true, setup.control.maxPowerPercent).catch(() => {
      // A refused press sent nothing and leaves nothing latched. A failed M3
      // write keeps the uncertain-on latch, so release() asks for M5 now
      // rather than at the next release signal.
      held.current = false;
      release();
    });
  };
  return (
    <FireHoldButton
      setup={setup}
      fireActive={fireActive}
      blockMessage={blockMessage}
      blockCaption={blockCaption}
      onPress={press}
      onRelease={release}
    />
  );
}

function FireHoldButton(props: {
  readonly setup: EnabledFireSetup;
  readonly fireActive: boolean;
  readonly blockMessage: string | null;
  readonly blockCaption: string | null;
  readonly onPress: () => void;
  readonly onRelease: () => void;
}): JSX.Element {
  const percent = `${formatFirePercent(props.setup.percent)}%`;
  const powerS = `S${props.setup.powerS}`;
  return (
    <button
      type="button"
      aria-label={`Hold for low-power Fire at ${percent} (${powerS})`}
      aria-pressed={props.fireActive}
      disabled={props.blockMessage !== null}
      onPointerDown={(event) => {
        event.preventDefault();
        props.onPress();
      }}
      onPointerLeave={props.onRelease}
      onBlur={props.onRelease}
      onKeyDown={(event) => {
        if (isFireKey(event.key) && !event.repeat) {
          event.preventDefault();
          props.onPress();
        }
      }}
      onKeyUp={(event) => {
        if (isFireKey(event.key)) props.onRelease();
      }}
      style={fireButtonStyle(props.fireActive)}
      title={
        props.blockMessage === null
          ? `Hold to turn on the positioning beam at ${percent} (${powerS}). Release always sends M5.`
          : `${props.blockMessage} Fire sends ${percent} (${powerS}) once ready.`
      }
    >
      <span style={titleStyle}>Fire</span>
      <span style={stateStyle}>{props.fireActive ? 'ON' : (props.blockCaption ?? 'HOLD')}</span>
      <span style={powerStyle}>{`${percent} · ${powerS}`}</span>
    </button>
  );
}

// No opt-in yet: the face says so and a click opens the Machine Setup row
// that holds it. A machine that cannot offer Fire at all says why and stays
// disabled. Neither state can send anything to the controller.
function FireSetupButton({ setup }: { readonly setup: UnreadyFireSetup }): JSX.Element {
  const canSetUp = setup.kind === 'needs-setup';
  return (
    <button
      type="button"
      disabled={!canSetUp}
      onClick={() => openMachineSetup({ kind: 'step', step: 'confirm', highlight: 'fire' })}
      aria-label={
        canSetUp ? 'Set up the Fire button for this machine' : `Fire unavailable: ${setup.reason}`
      }
      title={canSetUp ? `${setup.reason} Click to open Machine Setup.` : setup.reason}
      style={setupButtonStyle}
    >
      <span style={titleStyle}>Fire</span>
      <span style={stateStyle}>{canSetUp ? 'Set up' : 'Unavailable'}</span>
    </button>
  );
}

function useMomentaryRelease(setFireActive: LaserState['setFireActive']): {
  readonly held: MutableRefObject<boolean>;
  readonly release: () => void;
} {
  const held = useRef(false);
  const releasePending = useRef(false);
  const release = useCallback(() => {
    if (releasePending.current) return;
    if (!held.current && !useLaserStore.getState().fireActive) return;
    held.current = false;
    releasePending.current = true;
    void setFireActive(false)
      .catch(controllerActionFailureHandler('Fire off'))
      .finally(() => {
        releasePending.current = false;
      });
  }, [setFireActive]);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') release();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (isFireKey(event.key)) release();
    };
    window.addEventListener('blur', release);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', release);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, [release]);
  return { held, release };
}

function isFireKey(key: string): boolean {
  return key === ' ' || key === 'Enter';
}

function fireButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...fireButtonBaseStyle,
    border: active ? '1px solid var(--lf-danger)' : '1px solid var(--lf-border)',
    background: active ? 'var(--lf-danger)' : 'var(--lf-bg-2)',
    color: active ? 'var(--lf-on-fill)' : 'var(--lf-text)',
  };
}

const fireButtonBaseStyle: React.CSSProperties = {
  gridArea: 'fire',
  minWidth: 76,
  height: 58,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  borderRadius: 4,
  userSelect: 'none',
  touchAction: 'none',
};
// Muted like Manual Air's not-ready face: present and explained, not armed.
const setupButtonStyle: React.CSSProperties = {
  ...fireButtonBaseStyle,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text-muted)',
};
const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700 };
const stateStyle: React.CSSProperties = { fontSize: 10 };
const powerStyle: React.CSSProperties = { fontSize: 10, opacity: 0.8 };
