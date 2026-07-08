// burnAlignMarkers — the wizard's burn step (F-CAM9): generate the five-
// marker pattern into the scene (undoable, replacing it like the other
// calibration generators) and run the NORMAL start-job flow — readiness
// checks, preflight, operator confirmation, streaming. No parallel job
// pipeline: the marker burn honors every safety gate a real job does.

import { generateCameraAlignPattern } from '../../../core/job';
import { runStartJobFlow } from '../../laser/start-job-flow';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { isActiveJob } from '../../state/laser-store-helpers';

export type BurnMarkersResult =
  // The job is streaming; the wizard should watch the streamer finish.
  | { readonly kind: 'started' }
  // The flow refused (readiness) or the operator cancelled the confirm.
  | { readonly kind: 'not-started' };

export async function burnAlignMarkers(
  options: { readonly powerPercent: number; readonly speedMmPerMin: number },
  // Injectable for tests; production uses the real start-job flow.
  startJobFlow: () => Promise<void> = runStartJobFlow,
): Promise<BurnMarkersResult> {
  const app = useStore.getState();
  const pattern = generateCameraAlignPattern({
    bedWidthMm: app.project.device.bedWidth,
    bedHeightMm: app.project.device.bedHeight,
    power: options.powerPercent,
    speed: options.speedMmPerMin,
  });
  app.replaceSceneWithGeneratedScene(pattern.scene);
  await startJobFlow();
  return isActiveJob(useLaserStore.getState().streamer)
    ? { kind: 'started' }
    : { kind: 'not-started' };
}
