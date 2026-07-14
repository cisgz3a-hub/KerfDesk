// The camera-alignment marker burn is compiled from a temporary Project. It
// uses the normal readiness/preflight/confirmation/streaming gates but never
// replaces the operator's scene or touches their undo history.

import { generateCameraAlignPattern } from '../../../core/job';
import type { Project } from '../../../core/scene';
import { useStore } from '../../state';
import { runTransientCameraJob } from './transient-camera-job';

export type BurnMarkersResult = { readonly kind: 'started' | 'not-started' };

export async function burnAlignMarkers(
  options: { readonly powerPercent: number; readonly speedMmPerMin: number },
  startTransientJob: (project: Project) => Promise<boolean> = runTransientCameraJob,
): Promise<BurnMarkersResult> {
  const app = useStore.getState();
  const pattern = generateCameraAlignPattern({
    bedWidthMm: app.project.device.bedWidth,
    bedHeightMm: app.project.device.bedHeight,
    power: options.powerPercent,
    speed: options.speedMmPerMin,
  });
  const started = await startTransientJob({ ...app.project, scene: pattern.scene });
  return { kind: started ? 'started' : 'not-started' };
}
