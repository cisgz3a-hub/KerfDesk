// Animated view changes (ADR-426). Pure maths on plain vectors so the path a
// view change takes is tested without WebGL.
//
// The camera swings around the target on the shortest arc between the two
// viewing directions while the target slides and the distance eases, so Top
// to Front reads as the part turning, not as the camera cutting away.

import type { Vec3 } from './camera-presets';

export type CameraPose = {
  readonly position: Vec3;
  readonly target: Vec3;
};

/** How long a view change takes, unless the operator asked for reduced motion. */
export const VIEW_TWEEN_MS = 520;

/** Cubic ease-out: fast start, gentle landing. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** The pose a fraction `t` (0 to 1, already eased) of the way from `from` to `to`. */
export function tweenPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const fromOffset = subtract(from.position, from.target);
  const toOffset = subtract(to.position, to.target);
  const fromDistance = length(fromOffset);
  const toDistance = length(toOffset);
  const direction = slerpUnit(
    scale(fromOffset, 1 / fromDistance),
    scale(toOffset, 1 / toDistance),
    t,
  );
  const distance = fromDistance + (toDistance - fromDistance) * t;
  const target = lerp(from.target, to.target, t);
  return { target, position: add(target, scale(direction, distance)) };
}

// Spherical interpolation between unit vectors. Opposite directions have no
// single shortest arc; they turn about +Z (or +X when both lie on the Z axis)
// so the swing stays level.
function slerpUnit(a: Vec3, b: Vec3, t: number): Vec3 {
  const cosine = Math.min(1, Math.max(-1, dot(a, b)));
  if (cosine > 0.9999) return normalize(lerp(a, b, t));
  const axis = cosine < -0.9999 ? halfTurnAxis(a) : normalize(cross(a, b));
  const angle = Math.acos(cosine) * t;
  return rotateAbout(a, axis, angle);
}

function halfTurnAxis(a: Vec3): Vec3 {
  const around = cross(a, { x: 0, y: 0, z: 1 });
  return length(around) > 1e-6 ? normalize(cross(around, a)) : { x: 1, y: 0, z: 0 };
}

// Rodrigues' rotation of v about a unit axis.
function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const across = cross(axis, v);
  const along = dot(axis, v) * (1 - cos);
  return {
    x: v.x * cos + across.x * sin + axis.x * along,
    y: v.y * cos + across.y * sin + axis.y * along,
    z: v.z * cos + across.z * sin + axis.z * along,
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3, factor: number): Vec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const size = length(v);
  return size > 0 ? scale(v, 1 / size) : { x: 0, y: 0, z: 1 };
}
