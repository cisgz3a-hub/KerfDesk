import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { nativeBedCaptureFrameKey } from '../state/native-bed-frame';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';

export type PrintCutCameraRequest = {
  readonly epoch: number;
  readonly frameKey: string;
  readonly isCurrent: () => boolean;
};

/** The frame must retain the capture's coordinate/session owner, never acquire a newer one. */
export function printCutCameraRequest(lifetimeIsCurrent: () => boolean): PrintCutCameraRequest {
  const { project } = useStore.getState();
  const laser = useLaserStore.getState();
  const { sourceEpoch } = useCameraStore.getState();
  const session = usePrintCutSessionStore.getState();
  const frameKey = nativeBedCaptureFrameKey(project.device, laser);
  return {
    epoch: laser.trustedPositionEpoch ?? 0,
    frameKey,
    isCurrent: () => {
      const current = useStore.getState();
      const currentLaser = useLaserStore.getState();
      const currentSession = usePrintCutSessionStore.getState();
      return (
        lifetimeIsCurrent() &&
        current.project.device.profileId === project.device.profileId &&
        useCameraStore.getState().sourceEpoch === sourceEpoch &&
        currentLaser.controllerSessionEpoch === laser.controllerSessionEpoch &&
        currentLaser.trustedPositionEpoch === laser.trustedPositionEpoch &&
        nativeBedCaptureFrameKey(current.project.device, currentLaser) === frameKey &&
        currentSession.first === session.first &&
        currentSession.second === session.second
      );
    },
  };
}
