import { useStore } from '../../state/store';
import { useCameraStore } from '../../state/camera-store';

/** A scan's coordinates belong to the document and camera geometry that measured them. */
export function pieceScanContext(): () => boolean {
  const {
    projectDocumentEpoch,
    project: { device },
  } = useStore.getState();
  const { sourceEpoch, sourceState, surfaceHeightMm, heightAreas } = useCameraStore.getState();
  return () => {
    const app = useStore.getState();
    const camera = useCameraStore.getState();
    return (
      app.projectDocumentEpoch === projectDocumentEpoch &&
      app.project.device.profileId === device.profileId &&
      app.project.device.cameraModel === device.cameraModel &&
      app.project.device.bedWidth === device.bedWidth &&
      app.project.device.bedHeight === device.bedHeight &&
      camera.sourceEpoch === sourceEpoch &&
      camera.sourceState === sourceState &&
      camera.surfaceHeightMm === surfaceHeightMm &&
      camera.heightAreas === heightAreas
    );
  };
}

/** Kept for a completed scan too, including while the Camera panel is closed. */
export function watchPieceScanContext(isCurrent: () => boolean, retire: () => void): () => void {
  const check = (): void => {
    if (!isCurrent()) retire();
  };
  const offApp = useStore.subscribe(check);
  const offCamera = useCameraStore.subscribe(check);
  return () => {
    offApp();
    offCamera();
  };
}
