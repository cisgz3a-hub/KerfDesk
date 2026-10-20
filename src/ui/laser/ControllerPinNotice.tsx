// ControllerPinNotice — one short machine-rail line while the controller's
// status report says its E-stop input is asserted or a motor driver reports a
// fault (`Pn:` E and F on grblHAL and FluidNC, ADR-644). Either can hold the
// machine before, or without, an alarm explaining it. Selected by value so the
// 250 ms status poll does not re-render the rail.

import { useLaserStore } from '../state/laser-store';

export function ControllerPinNotice(): JSX.Element | null {
  const estop = useLaserStore((s) => s.statusReport?.pins?.estop === true);
  const motorFault = useLaserStore((s) => s.statusReport?.pins?.motorFault === true);
  const text = pinNoticeText(estop, motorFault);
  if (text === null) return null;
  return (
    <div role="status" style={noticeStyle}>
      {text}
    </div>
  );
}

export function pinNoticeText(estop: boolean, motorFault: boolean): string | null {
  if (estop && motorFault) return 'The controller reports its E-stop pressed and a motor fault.';
  if (estop) return 'The controller reports its E-stop pressed.';
  if (motorFault) return 'The controller reports a motor fault.';
  return null;
}

const noticeStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontSize: 'var(--lf-text-sm)',
  fontWeight: 600,
};
