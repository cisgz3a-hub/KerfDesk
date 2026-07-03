// jog-direction — maps operator-relative jog directions (↑ = away from the
// operator, → = the operator's right) onto machine-axis signs for a device
// origin. Must stay in lockstep with origin-transform.ts: a jog arrow has to
// move the head the same physical way the canvas mapping says geometry lands
// on the bed, or the pad rams the head on rear-*/right-origin machines.

import { assertNever } from '../scene';
import type { Origin } from './device-profile';

export type JogAxisSigns = {
  // Multiplier turning a "physical right" jog into a machine X delta.
  readonly x: 1 | -1;
  // Multiplier turning a "physical away from operator" jog into a machine Y delta.
  readonly y: 1 | -1;
};

export function jogAxisSignsForOrigin(origin: Origin): JogAxisSigns {
  switch (origin) {
    case 'front-left':
      return { x: 1, y: 1 };
    case 'front-right':
      return { x: -1, y: 1 };
    case 'rear-left':
      return { x: 1, y: -1 };
    case 'rear-right':
      return { x: -1, y: -1 };
    case 'center':
      return { x: 1, y: 1 };
    default:
      return assertNever(origin, 'Origin');
  }
}
