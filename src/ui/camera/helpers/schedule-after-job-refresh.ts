// Own the settling delay as well as the eventual capture. A changed viewing
// intent permanently cancels the old job's refresh, even if later restored.
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import type { LiveCanvasRun } from '../../state/canvas-motion-plan';
import { useLaserStore } from '../../state/laser-store';
import { onOverlayCaptureCancelled } from '../capture-overlay-still';
import { useCameraHelpersStore } from './camera-helpers-store';
import { refreshCameraPicture } from './refresh-picture';

export function scheduleAfterJobRefresh(plan: LiveCanvasRun['plan'], delay: number): () => void {
  const camera = useCameraStore.getState();
  const app = useStore.getState();
  const stops: Array<() => void> = [];
  const cancel = (): void => {
    clearTimeout(timer);
    stops.splice(0).forEach((stop) => stop());
  };
  const current = (): boolean => {
    const now = useCameraStore.getState();
    const document = useStore.getState();
    const run = useLaserStore.getState().liveCanvasRun;
    return (
      useCameraHelpersStore.getState().settings.refreshAfterJob &&
      run?.plan === plan &&
      run.lifecycle === 'finished' &&
      now.sourceEpoch === camera.sourceEpoch &&
      now.sourceState === camera.sourceState &&
      now.overlayStill === camera.overlayStill &&
      now.bedPicture === camera.bedPicture &&
      now.overlayVisible === camera.overlayVisible &&
      now.placementActive === camera.placementActive &&
      document.projectDocumentEpoch === app.projectDocumentEpoch &&
      document.project.device === app.project.device
    );
  };
  const check = (): void => {
    if (!current()) cancel();
  };
  const timer = setTimeout(() => {
    const shouldRefresh = current();
    cancel();
    // Capture takes over ownership synchronously before its first await.
    if (shouldRefresh) void refreshCameraPicture();
  }, delay);
  stops.push(
    onOverlayCaptureCancelled(cancel),
    useCameraStore.subscribe(check),
    useStore.subscribe(check),
    useLaserStore.subscribe(check),
    useCameraHelpersStore.subscribe(check),
  );
  return cancel;
}
