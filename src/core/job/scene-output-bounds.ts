import type { DeviceProfile } from '../devices';
import type { Scene } from '../scene';
import { compileJob } from './compile-job';
import { computeJobBounds, type JobBounds } from './job-bounds';

export function computeSceneOutputBounds(scene: Scene, device: DeviceProfile): JobBounds | null {
  return computeJobBounds(compileJob(scene, device), device);
}
