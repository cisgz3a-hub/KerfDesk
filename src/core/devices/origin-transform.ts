// toMachineCoords — maps a point from the scene's logical SVG-style frame
// (Y down, X right, origin at top-left of canvas) into the device's machine
// coords. PROJECT.md non-negotiable #2 — Origin honesty.
//
// Scene convention (input):  +X right, +Y down  (matches SVG / canvas convention)
// Machine convention (output): depends on origin (matches GRBL / LightBurn).
//
// GRBL convention recap:
//   * Machine origin (0, 0) sits at the homing corner.
//   * +Y always means "away from the operator" — so for front-* origins the
//     emitted Y must be flipped from the SVG Y; for rear-* origins it's not.
//   * +X always means "to the operator's right" — front-right / rear-right
//     mirror X within the bed.
//
// Result: what the user sees at the TOP of the canvas (low SVG Y) lands at
// the BACK of the bed for front-* origins, and at the FRONT for rear-*.

import { assertNever, type Vec2 } from '../scene';
import type { DeviceProfile, Origin } from './device-profile';

export function toMachineCoords(p: Vec2, device: DeviceProfile): Vec2 {
  return originTransform(p, device.origin, device.bedWidth, device.bedHeight);
}

// Exact inverse of toMachineCoords. Most origin transforms are their own
// inverse (axis mirrors), but 'center' is not: its X axis is translated,
// so the preview frame mapping (H3) needs a real inverse, not a re-apply.
export function toSceneCoords(p: Vec2, device: DeviceProfile): Vec2 {
  return inverseOriginTransform(p, device.origin, device.bedWidth, device.bedHeight);
}

function inverseOriginTransform(p: Vec2, origin: Origin, bedW: number, bedH: number): Vec2 {
  switch (origin) {
    case 'front-left':
      return { x: p.x, y: bedH - p.y };
    case 'front-right':
      return { x: bedW - p.x, y: bedH - p.y };
    case 'rear-left':
      return { x: p.x, y: p.y };
    case 'rear-right':
      return { x: bedW - p.x, y: p.y };
    case 'center':
      return { x: p.x + bedW / 2, y: bedH / 2 - p.y };
    default:
      return assertNever(origin, 'Origin');
  }
}

function originTransform(p: Vec2, origin: Origin, bedW: number, bedH: number): Vec2 {
  switch (origin) {
    case 'front-left':
      // Y flipped: SVG top → bed back. X unchanged.
      return { x: p.x, y: bedH - p.y };
    case 'front-right':
      // Y flipped + X mirrored within bed.
      return { x: bedW - p.x, y: bedH - p.y };
    case 'rear-left':
      // Rear-* origins have machine +Y already pointing toward the operator,
      // matching SVG Y-down. No flip needed.
      return { x: p.x, y: p.y };
    case 'rear-right':
      // X mirrored only.
      return { x: bedW - p.x, y: p.y };
    case 'center':
      // Bed center origin. +Y is "away from operator", so flip SVG Y around
      // the bed midline. Output range: [-bedW/2, +bedW/2] × [-bedH/2, +bedH/2].
      return { x: p.x - bedW / 2, y: bedH / 2 - p.y };
    default:
      return assertNever(origin, 'Origin');
  }
}
