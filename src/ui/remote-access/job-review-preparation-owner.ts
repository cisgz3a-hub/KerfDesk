import { useStore, type AppState } from '../state/store';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useCameraStore } from '../state/camera-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { ownCurrentStartPreparation } from '../laser/start-preparation-owner';
import { startMachineInputsKey } from '../laser/start-job-source';

/** Fence both synchronous and worker preparation against every observed input. */
export function ownRemoteReviewPreparation(app: AppState, laser: LaserState, signal?: AbortSignal) {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const owner = ownCurrentStartPreparation(app, laser, controller.signal);
  const camera = useCameraStore.getState();
  const machineKey = startMachineInputsKey(app.project, laser, camera);
  const reviewOwner = useJobReviewStore.getState().requestOwner;
  const changed = (): boolean =>
    app.project !== useStore.getState().project ||
    useStore.getState().pendingUndo !== null ||
    useJobReviewStore.getState().requestOwner !== reviewOwner ||
    useFramePreparationStore.getState().pending ||
    machineKey !==
      startMachineInputsKey(app.project, useLaserStore.getState(), useCameraStore.getState());
  const observe = (): void => {
    if (changed()) cancel();
  };
  const unsubscribe = [
    useStore.subscribe(observe),
    useLaserStore.subscribe(observe),
    useCameraStore.subscribe(observe),
    useFramePreparationStore.subscribe(observe),
    useJobReviewStore.subscribe(observe),
  ];
  observe();
  return {
    camera,
    machineKey,
    signal: owner.signal,
    current: (): boolean => !owner.signal.aborted && !owner.inputsChanged() && !changed(),
    dispose: (): void => {
      owner.dispose();
      unsubscribe.forEach((stop) => stop());
      signal?.removeEventListener('abort', cancel);
    },
  };
}
