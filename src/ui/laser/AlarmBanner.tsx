// AlarmBanner — the machine rail's Alarm notice and its recovery buttons.
//
// After a critical event (hard or soft limit, E-stop, motor fault) GRBL,
// grblHAL and FluidNC print "Reset to continue" and accept only a soft reset,
// so the banner then offers Reset (Ctrl-X) instead of Home and Unlock, which
// would go unanswered, fail with error:79, or unlock nothing (controller audit
// 2026-09-25 GP-2, HF-2, HF-3; ADR-393). After the reset the controller comes
// back locked in Alarm and the ordinary Home / Unlock offer returns. The
// alarm's own physical step (release the E-stop, clear the switch) comes
// before the reset, and a lock from before the connection, latched from a
// refusal or a report, says so (UX audit U5-P2-1, U5-P3-2; ADR-393 Amendment 1).
//
// Stock GRBL that refused a single-axis Home (`$HX`, error:3) stays in its
// homing state and reports Home, not Alarm, until a reset; the banner offers
// the same Reset for it (controller-reset-required.ts; controller audit A-7,
// ADR-375).
//
// AlarmCard shows AbortStoppedCard instead for the ALARM:3 that answers the
// operator's own Abort (ADR-341 Amendment 11).

import { presentAlarm } from '../../core/controllers/grbl/response-presentation';
import type { ControllerKind } from '../../core/devices';
import type { MachineKind } from '../../core/scene';
import type { JobStopRequest } from '../state/job-stop-request';
import { resetOfferMessage } from '../state/controller-reset-required';
import { AbortStoppedCard } from './AbortStoppedCard';
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
  const resetOffer = resetOfferMessage(props.resetRequired, props);
  const alarmAction =
    resetOffer ?? alarmRecoveryAction(props.controllerKind, props.code, alarm?.action);
  return (
    <div style={alarmStyle} role="alert">
      <AlarmHeading code={props.code} alarm={alarm} resetRequired={props.resetRequired} />
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

function AlarmHeading(props: {
  readonly code: number | null;
  readonly alarm: ReturnType<typeof presentAlarm> | null;
  readonly resetRequired: boolean | 'homing-state';
}): JSX.Element {
  const homingState = props.code === null && props.resetRequired === 'homing-state';
  // No ALARM:N seen, yet only a reset is accepted: the lock predates the
  // connection, and "homed or unlocked" would name two refused commands.
  const lockedBeforeConnect = props.code === null && props.resetRequired === true;
  return (
    <>
      <strong>
        {lockedBeforeConnect
          ? 'Controller needs a reset'
          : alarmTitle(props.code, props.alarm?.title, homingState)}
      </strong>
      {!homingState && !lockedBeforeConnect && (
        <p style={alarmDetailStyle}>
          {props.code === null
            ? 'GRBL has locked jog, frame, and start until the machine is homed or unlocked.'
            : (props.alarm?.detail ?? '')}
        </p>
      )}
    </>
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

/** The rail's Alarm card: the stopped-job card for the ALARM:3 of the
 *  operator's own Abort (ADR-341 Amendment 11), else AlarmBanner. A reset the
 *  controller still requires keeps AlarmBanner's Reset offer. */
export function AlarmCard(
  props: Parameters<typeof AlarmBanner>[0] & {
    readonly operatorAbort: JobStopRequest | null;
    readonly machineKind: MachineKind;
  },
): JSX.Element {
  const { operatorAbort, machineKind, ...banner } = props;
  if (operatorAbort === null || props.resetRequired !== false) return <AlarmBanner {...banner} />;
  return (
    <AbortStoppedCard
      request={operatorAbort}
      controllerKind={props.controllerKind}
      machineKind={machineKind}
      homingEnabled={props.homingEnabled}
      homeFromAlarm={props.homeFromAlarm}
      canUnlock={props.canUnlock}
      onHome={props.onHome}
      onUnlock={props.onUnlock}
    />
  );
}
