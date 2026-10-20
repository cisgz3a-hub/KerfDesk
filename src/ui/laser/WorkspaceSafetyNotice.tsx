// ADR-634: the machine-safety notice floats over the top of the canvas as a
// toast. In the machine toolbar it took a row of its own, so a failed
// controller write pushed the whole workspace down. Here it takes no layout
// space and stays clear of the rails' job controls and the Live Motion popup,
// and it still stays until the operator acknowledges it. The controller
// recovery card stacks under it (ADR-642).

import { useRef, type CSSProperties } from 'react';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { motionOwnerAwaitsMissingReply } from '../state/laser-motion-release';
import { isFileOnlyController, useControllerReconnect } from './controller-reconnect';
import { SafetyNoticeBanner } from './SafetyNoticeBanner';
import { useLiveMotionRoom } from './use-live-motion-room';
import { useControllerRecovery, WorkspaceControllerRecovery } from './WorkspaceControllerRecovery';
import './workspace-safety-notice.css';

export function WorkspaceSafetyNotice(): JSX.Element | null {
  const platform = usePlatform();
  const active = useLaserStore((state) => state.safetyNotice !== null);
  const reconnectRecommended = useLaserStore((state) => state.getControllerReconnectRecommended());
  // A motion owner locks Reconnect, except one that only a missing reply
  // holds on an Idle machine: a new session is the way to clear it (ADR-640).
  const motionBusy = useLaserStore(
    (state) => state.motionOperation !== null && !motionOwnerAwaitsMissingReply(state),
  );
  const fileOnly = useStore((state) => isFileOnlyController(state.project.device.controllerKind));
  const reconnect = useControllerReconnect();
  const recovery = useControllerRecovery();
  const shown = active || recovery !== null;
  const toastRef = useRef<HTMLDivElement>(null);
  const room = useLiveMotionRoom(toastRef, shown);
  if (!shown) return null;
  const roomStyle =
    room === null ? undefined : ({ '--lf-safety-notice-room': `${room}px` } as CSSProperties);
  return (
    <div className="lf-safety-notice-anchor">
      <div ref={toastRef} className="lf-safety-notice-toast" style={roomStyle}>
        {active ? (
          <SafetyNoticeBanner
            onReconnect={reconnect}
            reconnectRecommended={reconnectRecommended}
            reconnectDisabled={!platform.serial.isSupported() || motionBusy || fileOnly}
          />
        ) : null}
        {recovery === null ? null : (
          <WorkspaceControllerRecovery key={recovery.key} recovery={recovery} />
        )}
      </div>
    </div>
  );
}
