import { useEffect, useRef } from 'react';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useUiStore } from '../state/ui-store';

/** An asynchronous capture belongs to its initiating document, camera setup,
 * mounted button and dialog opening. Abandoned captures publish nothing. */
export function useCameraTraceLifetime(): () => () => boolean {
  const captureEpoch = useRef(0);
  useEffect(
    () => () => {
      captureEpoch.current += 1;
    },
    [],
  );
  useEffect(
    () =>
      useUiStore.subscribe((next, previous) => {
        if (next.imageDialog !== previous.imageDialog) captureEpoch.current += 1;
      }),
    [],
  );
  return () => {
    const epoch = ++captureEpoch.current;
    const {
      projectDocumentEpoch,
      project: { device },
    } = useStore.getState();
    const { sourceState, surfaceHeightMm } = useCameraStore.getState();
    const dialog = useUiStore.getState().imageDialog;
    return () => {
      const current = useStore.getState();
      const camera = useCameraStore.getState();
      return (
        captureEpoch.current === epoch &&
        current.projectDocumentEpoch === projectDocumentEpoch &&
        useUiStore.getState().imageDialog === dialog &&
        camera.sourceState === sourceState &&
        camera.surfaceHeightMm === surfaceHeightMm &&
        current.project.device.cameraAlignment === device.cameraAlignment &&
        current.project.device.cameraCalibration === device.cameraCalibration &&
        current.project.device.bedWidth === device.bedWidth &&
        current.project.device.bedHeight === device.bedHeight
      );
    };
  };
}
