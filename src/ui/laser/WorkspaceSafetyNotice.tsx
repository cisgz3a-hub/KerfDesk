// ADR-634: the machine-safety notice floats over the top of the canvas as a
// toast. In the machine toolbar it took a row of its own, so a failed
// controller write pushed the whole workspace down. Here it takes no layout
// space and stays clear of the rails' job controls and the Live Motion popup,
// and it still stays until the operator acknowledges it.

import { useRef, type CSSProperties } from 'react';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isFileOnlyController, useControllerReconnect } from './controller-reconnect';
import { SafetyNoticeBanner } from './SafetyNoticeBanner';
import { useLiveMotionRoom } from './use-live-motion-room';
import './workspace-safety-notice.css';

export function WorkspaceSafetyNotice(): JSX.Element | null {
  const platform = usePlatform();
  const active = useLaserStore((state) => state.safetyNotice !== null);
  const reconnectRecommended = useLaserStore((state) => state.getControllerReconnectRecommended());
  const motionBusy = useLaserStore((state) => state.motionOperation !== null);
  const fileOnly = useStore((state) => isFileOnlyController(state.project.device.controllerKind));
  const reconnect = useControllerReconnect();
  const toastRef = useRef<HTMLDivElement>(null);
  const room = useLiveMotionRoom(toastRef, active);
  if (!active) return null;
  const roomStyle =
    room === null ? undefined : ({ '--lf-safety-notice-room': `${room}px` } as CSSProperties);
  return (
    <div className="lf-safety-notice-anchor">
      <div ref={toastRef} className="lf-safety-notice-toast" style={roomStyle}>
        <SafetyNoticeBanner
          onReconnect={reconnect}
          reconnectRecommended={reconnectRecommended}
          reconnectDisabled={!platform.serial.isSupported() || motionBusy || fileOnly}
        />
      </div>
    </div>
  );
}
