// AlarmBanner — the machine rail's Alarm notice and its recovery buttons.
//
// After a critical event (hard or soft limit, E-stop, motor fault) GRBL,
// grblHAL and FluidNC print "Reset to continue" and accept only a soft reset,
// so the banner then offers Reset (Ctrl-X) instead of Home and Unlock, which
// would go unanswered, fail with error:79, or unlock nothing (controller audit
// 2026-09-25 GP-2, HF-2, HF-3; ADR-393). After the reset the controller comes
// back locked in Alarm and the ordinary Home / Unlock offer returns.
//
// Stock GRBL that refused a single-axis Home (`$HX`, error:3) stays in its
// homing state and reports Home, not Alarm, until a reset; the banner offers
// the same Reset for it (controller-reset-required.ts; controller audit A-7,
// ADR-375).

import { presentAlarm } from '../../core/controllers/grbl/response-presentation';
import type { ControllerKind } from '../../core/devices';
import { resetOfferMessage } from '../state/controller-reset-required';
import { AlarmRecoveryActions } from './AlarmRecoveryActions';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';

export function AlarmBanner(props: {
  readonly code: number | null;
  readonly controllerKind: ControllerKind;
  readonly homingEnabled: boolean;
  readonly homeFromAlarm: boolean;
  readonly canUnlock: boolean;
  readonly resetRequired: boolean | 'homing-state';
  readonly onHome: () => void;
  readonly onConfigureHoming: () => void;
  readonly onUnlock: () => void;
  readonly onReset: () => void;
}): JSX.Element {
  const alarm = props.code === null ? null : presentAlarm(props.controllerKind, props.code);
  const resetOffer = resetOfferMessage(props.resetRequired);
  const alarmAction =
    resetOffer ?? alarmRecoveryAction(props.controllerKind, props.code, alarm?.action);
  const homingState = props.code === null && props.resetRequired === 'homing-state';
  return (
    <div style={alarmStyle} role="alert">
      <strong>{alarmTitle(props.code, alarm?.title, homingState)}</strong>
      {!homingState && (
        <p style={alarmDetailStyle}>
          {props.code === null
            ? 'GRBL has locked jog, frame, and start until the machine is homed or unlocked.'
            : (alarm?.detail ?? '')}
        </p>
      )}
      {alarmAction !== undefined && <p style={alarmDetailStyle}>{alarmAction}</p>}
      {resetOffer !== null ? (
        <button
          type="button"
          onClick={props.onReset}
          title="Send Ctrl-X soft reset. The controller restarts locked in Alarm; then unlock or home it."
        >
          Reset (Ctrl-X)
        </button>
      ) : (
        <AlarmRecoveryActions
          homingEnabled={props.homingEnabled}
          homeFromAlarm={props.homeFromAlarm}
          canUnlock={props.canUnlock}
          onHome={props.onHome}
          onConfigureHoming={props.onConfigureHoming}
          onUnlock={props.onUnlock}
        />
      )}
    </div>
  );
}

function alarmTitle(code: number | null, title: string | undefined, homingState: boolean): string {
  if (code !== null) return `Alarm ${code}: ${title ?? 'unknown'}`;
  return homingState ? 'Controller is stuck in its homing state' : 'Controller reports Alarm';
}

function alarmRecoveryAction(
  controllerKind: ControllerKind,
  code: number | null,
  action: string | undefined,
): string | undefined {
  if (code !== null && controllerKind === 'fluidnc') return action;
  return action ?? STATUS_ALARM_START_MESSAGE;
}

const alarmStyle: React.CSSProperties = {
  border: '1px solid var(--lf-danger)',
  background: 'var(--lf-tint-danger)',
  color: 'var(--lf-danger-fg)',
  padding: 8,
  borderRadius: 4,
};
const alarmDetailStyle: React.CSSProperties = { margin: '4px 0' };
