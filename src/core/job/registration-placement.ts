// Registration jig placement (ADR-057). A jig set burns in two runs — every
// outline first, then every artwork copy — and BOTH runs anchor to the SAME
// combined physical fixture bounds. Otherwise the artwork run would re-anchor
// to its own bounds instead of preserving its position inside each outline.
// Pure: no clock, no random, no I/O.

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
  // Force the registration layer's output ON for this probe so every outline
  // still measures during the art run. The combined compiled bounds are the one
  // fixture anchor shared by Outline-only and Artwork-only output.
  const layer = findRegistrationLayer(scene) ?? createRegistrationLayer();
  const boxScene: Scene = { ...scene, objects: boxes, layers: [{ ...layer, output: true }] };
  return computeJobBounds(compileJob(boxScene, device));
}
