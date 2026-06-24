// Registration jig placement (ADR-057). The placement jig burns in two runs —
// the box outline first, then the artwork — and BOTH runs must anchor to the
// SAME physical frame, or the artwork re-anchors to its own bounds and lands at
// the bed corner instead of inside the box. computeRegistrationBoxBounds returns
// the box's machine-space bounds so prepareOutput can anchor every run to the
// box, regardless of which layer's output is enabled for that run. Pure: no
// clock, no random, no I/O.

import type { DeviceProfile } from '../devices';
import {
  createRegistrationLayer,
  findRegistrationBoxes,
  findRegistrationLayer,
  type Scene,
} from '../scene';
import { compileJob } from './compile-job';
import { computeJobBounds, type JobBounds } from './job-bounds';

export function computeRegistrationBoxBounds(
  scene: Scene,
  device: DeviceProfile,
): JobBounds | null {
  const boxes = findRegistrationBoxes(scene);
  if (boxes.length === 0) return null;
  // Force the registration layer's output ON for this probe so the box still
  // measures during the art run, when its real layer output is toggled off. The
  // object->layer join is by color, so only the box objects compile here — this
  // is the box's bounds through the exact same machine-space path the burn uses.
  const layer = findRegistrationLayer(scene) ?? createRegistrationLayer();
  const boxScene: Scene = { ...scene, objects: boxes, layers: [{ ...layer, output: true }] };
  return computeJobBounds(compileJob(boxScene, device));
}
