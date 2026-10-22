import type { DeviceProfile } from '../devices';
import type { Scene } from '../scene';
import { compileJob } from './compile-job';
import { computeJobPlacementBounds, type JobBounds } from './job-bounds';

// The whole-scene Job Origin anchor for selected output, measured like any
// placement anchor: at design, without the scan-offset shift (ADR-052 Amd 1).
export function computeSceneOutputBounds(scene: Scene, device: DeviceProfile): JobBounds | null {
  return computeJobPlacementBounds(compileJob(scene, device), device);
}
