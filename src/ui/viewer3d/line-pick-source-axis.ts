// The ID pass needs a full-source axis even when the least-slope plane is edge-on.
// This immutable descriptor never changes the source position or visible geometry.
import type * as ThreeNamespace from 'three';

export const PICK_SOURCE_AXIS_ATTRIBUTE = 'kerfdeskPickSourceAxis';

/** Canonical stored endpoints give exact retraces identical packed direction bits. */
export function writePickSourceAxis(
  target: Float32Array,
  offset: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  target.fill(0, offset, offset + 3);
  if (!finiteEndpoints(x0, y0, z0, x1, y1, z1)) return;
  const first = x0 < x1 || (x0 === x1 && (y0 < y1 || (y0 === y1 && z0 < z1)));
  const dx = first ? x1 - x0 : x0 - x1;
  const dy = first ? y1 - y0 : y0 - y1;
  const dz = first ? z1 - z0 : z0 - z1;
  // Scale by a power of two before packing: finite Float32 differences can
  // exceed Float32. This keeps every component below two without an extra
  // non-power-of-two division rounding of an already representable direction.
  const maximum = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  if (maximum === 0) return;
  const scale = 2 ** Math.floor(Math.log2(maximum));
  target[offset] = packedDirection(dx / scale);
  target[offset + 1] = packedDirection(dy / scale);
  target[offset + 2] = packedDirection(dz / scale);
}

function packedDirection(value: number): number {
  const packed = Math.fround(value);
  return packed === 0 ? 0 : packed;
}

function finiteEndpoints(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): boolean {
  return (
    Number.isFinite(x0) &&
    Number.isFinite(y0) &&
    Number.isFinite(z0) &&
    Number.isFinite(x1) &&
    Number.isFinite(y1) &&
    Number.isFinite(z1)
  );
}

/** Lazy ID geometry only: 12 bytes/fat row or 24 bytes/native pair, no positions copy. */
export function addPickSourceAxes(
  three: typeof ThreeNamespace,
  geometry: ThreeNamespace.BufferGeometry,
  kind: 'fat' | 'native',
): ThreeNamespace.BufferAttribute {
  const existing = geometry.getAttribute(PICK_SOURCE_AXIS_ATTRIBUTE);
  if (existing !== undefined) return existing as ThreeNamespace.BufferAttribute;
  const start = geometry.getAttribute(kind === 'fat' ? 'instanceStart' : 'position');
  const end = kind === 'fat' ? geometry.getAttribute('instanceEnd') : start;
  const axes = new Float32Array(start.count * 3);
  const step = kind === 'fat' ? 1 : 2;
  for (let index = 0; index + step - 1 < start.count; index += step) {
    const last = index + step - 1;
    writePickSourceAxis(
      axes,
      index * 3,
      start.getX(index),
      start.getY(index),
      start.getZ(index),
      end.getX(last),
      end.getY(last),
      end.getZ(last),
    );
    if (kind === 'native') axes.copyWithin((index + 1) * 3, index * 3, index * 3 + 3);
  }
  const attribute =
    kind === 'fat'
      ? new three.InstancedBufferAttribute(axes, 3)
      : new three.BufferAttribute(axes, 3);
  geometry.setAttribute(PICK_SOURCE_AXIS_ATTRIBUTE, attribute);
  return attribute;
}
