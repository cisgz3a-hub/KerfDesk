// One depth descriptor per stored Float32 source segment. The XY gradient has
// minimum norm; the offsets and canonical origin anchor the packed normal.
import type * as ThreeNamespace from 'three';

export const DEPTH_PLANE_ATTRIBUTE = 'kerfdeskDepthPlane';
export const DEPTH_PLANE_OFFSET_ATTRIBUTE = 'kerfdeskDepthPlaneOffset';
export const DEPTH_PLANE_ORIGIN_ATTRIBUTE = 'kerfdeskDepthPlaneOrigin';

/** Inputs are stored Float32 endpoints; anchor the offset to the packed normal. */
export function writeDepthPlane(
  target: Float32Array,
  offset: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  residualTarget?: Float32Array,
  residualOffset = 0,
  originTarget?: Float32Array,
  originOffset = 0,
): void {
  clearPlane(target, offset, residualTarget, residualOffset, originTarget, originOffset);
  if (z0 === z1) {
    target[offset + 2] = 1;
    target[offset + 3] = z0 === 0 ? 0 : -z0;
    retainFinitePlane(target, offset, residualTarget, residualOffset);
    writeOrigin(
      target,
      offset,
      residualTarget,
      residualOffset,
      originTarget,
      originOffset,
      x0,
      y0,
      z0,
      x1,
      y1,
      z1,
    );
    return;
  }
  // Canonical direction and anchor give reversed endpoints identical arithmetic.
  const first = firstEndpoint(x0, y0, z0, x1, y1, z1);
  const x = first ? x0 : x1;
  const y = first ? y0 : y1;
  const z = first ? z0 : z1;
  const dx = (first ? x1 : x0) - x;
  const dy = (first ? y1 : y0) - y;
  const dz = (first ? z1 : z0) - z;
  const lengthSquared = dx * dx + dy * dy;
  // A varying-Z vertical segment cannot define a plane with z coefficient 1.
  if (lengthSquared === 0) return;
  // Anchor the offset to the coefficients actually uploaded, not their double precursors.
  const a = packedGradient((-dx * dz) / lengthSquared);
  const b = packedGradient((-dy * dz) / lengthSquared);
  const c = -z - a * x - b * y;
  writeCoefficients(target, offset, a, b, c, residualTarget, residualOffset);
  writeOrigin(
    target,
    offset,
    residualTarget,
    residualOffset,
    originTarget,
    originOffset,
    x0,
    y0,
    z0,
    x1,
    y1,
    z1,
  );
}

function firstEndpoint(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): boolean {
  return x0 < x1 || (x0 === x1 && (y0 < y1 || (y0 === y1 && z0 < z1)));
}

function packedGradient(value: number): number {
  const packed = Math.fround(value);
  return packed === 0 ? 0 : packed;
}

function writeCoefficients(
  target: Float32Array,
  offset: number,
  a: number,
  b: number,
  c: number,
  residualTarget: Float32Array | undefined,
  residualOffset: number,
): void {
  // Exact zero has one bit pattern; this is not a tolerance or coordinate snap.
  target[offset] = a === 0 ? 0 : a;
  target[offset + 1] = b === 0 ? 0 : b;
  target[offset + 2] = 1;
  target[offset + 3] = c === 0 ? 0 : c;
  if (residualTarget !== undefined) {
    const low = Math.fround(c - Math.fround(c));
    residualTarget[residualOffset] = low === 0 ? 0 : low;
  }
  retainFinitePlane(target, offset, residualTarget, residualOffset);
}

function writeOrigin(
  target: Float32Array,
  offset: number,
  residualTarget: Float32Array | undefined,
  residualOffset: number,
  originTarget: Float32Array | undefined,
  originOffset: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  if (originTarget === undefined || target[offset + 2] === 0) return;
  if (!finiteEndpoints(x0, y0, z0, x1, y1, z1)) {
    clearPlane(target, offset, residualTarget, residualOffset, originTarget, originOffset);
    return;
  }
  const first = firstEndpoint(x0, y0, z0, x1, y1, z1);
  const x = first ? x0 : x1;
  const y = first ? y0 : y1;
  const z = first ? z0 : z1;
  // Canonicalise exact signed zero only; source position buffers remain untouched.
  originTarget[originOffset] = x === 0 ? 0 : x;
  originTarget[originOffset + 1] = y === 0 ? 0 : y;
  originTarget[originOffset + 2] = z === 0 ? 0 : z;
  // The local constant uses the normal/high offset and origin actually packed.
  const local = localPlaneOffset(target, offset, originTarget, originOffset);
  originTarget[originOffset + 3] = local === 0 ? 0 : local;
  if (!finiteOrigin(originTarget, originOffset))
    clearPlane(target, offset, residualTarget, residualOffset, originTarget, originOffset);
}

function localPlaneOffset(
  plane: Float32Array,
  offset: number,
  origin: Float32Array,
  originOffset: number,
): number {
  return Math.fround(
    (plane[offset + 3] ?? 0) +
      (plane[offset] ?? 0) * (origin[originOffset] ?? 0) +
      (plane[offset + 1] ?? 0) * (origin[originOffset + 1] ?? 0) +
      (origin[originOffset + 2] ?? 0),
  );
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

function finiteOrigin(target: Float32Array, offset: number): boolean {
  return (
    Number.isFinite(target[offset]) &&
    Number.isFinite(target[offset + 1]) &&
    Number.isFinite(target[offset + 2]) &&
    Number.isFinite(target[offset + 3])
  );
}

function clearPlane(
  target: Float32Array,
  offset: number,
  residualTarget?: Float32Array,
  residualOffset = 0,
  originTarget?: Float32Array,
  originOffset = 0,
): void {
  target[offset] = 0;
  target[offset + 1] = 0;
  target[offset + 2] = 0;
  target[offset + 3] = 0;
  if (residualTarget !== undefined) residualTarget[residualOffset] = 0;
  if (originTarget !== undefined) originTarget.fill(0, originOffset, originOffset + 4);
}

function retainFinitePlane(
  target: Float32Array,
  offset: number,
  residualTarget?: Float32Array,
  residualOffset = 0,
): void {
  // A finite JS coefficient may overflow while packing the actual GPU descriptor.
  if (
    !Number.isFinite(target[offset]) ||
    !Number.isFinite(target[offset + 1]) ||
    !Number.isFinite(target[offset + 2]) ||
    !Number.isFinite(target[offset + 3]) ||
    (residualTarget !== undefined && !Number.isFinite(residualTarget[residualOffset]))
  )
    clearPlane(target, offset, residualTarget, residualOffset);
}

/** Immutable geometry gets normal, low offset and source origin without a position copy. */
export function addDepthPlanes(
  three: typeof ThreeNamespace,
  geometry: ThreeNamespace.BufferGeometry,
  kind: 'fat' | 'native',
): ThreeNamespace.BufferAttribute {
  const existing = geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE);
  const existingOffset = geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE);
  const existingOrigin = geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE);
  if (existing !== undefined && existingOffset !== undefined && existingOrigin !== undefined)
    return existing as ThreeNamespace.BufferAttribute;
  const start = geometry.getAttribute(kind === 'fat' ? 'instanceStart' : 'position');
  const end = kind === 'fat' ? geometry.getAttribute('instanceEnd') : start;
  const planes = planeValues(existing, start.count, 4);
  const offsets = planeValues(existingOffset, start.count, 1);
  const origins = planeValues(existingOrigin, start.count, 4);
  fillDepthPlanes(start, end, planes, offsets, origins, kind);
  const attribute = existing ?? depthAttribute(three, planes, 4, kind);
  const offsetAttribute = existingOffset ?? depthAttribute(three, offsets, 1, kind);
  const originAttribute = existingOrigin ?? depthAttribute(three, origins, 4, kind);
  geometry.setAttribute(DEPTH_PLANE_ATTRIBUTE, attribute);
  geometry.setAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE, offsetAttribute);
  geometry.setAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE, originAttribute);
  return attribute as ThreeNamespace.BufferAttribute;
}

function planeValues(
  attribute: ThreeNamespace.BufferAttribute | ThreeNamespace.InterleavedBufferAttribute | undefined,
  count: number,
  size: number,
): Float32Array {
  return (attribute?.array as Float32Array | undefined) ?? new Float32Array(count * size);
}

function fillDepthPlanes(
  start: ThreeNamespace.BufferAttribute | ThreeNamespace.InterleavedBufferAttribute,
  end: ThreeNamespace.BufferAttribute | ThreeNamespace.InterleavedBufferAttribute,
  planes: Float32Array,
  offsets: Float32Array,
  origins: Float32Array,
  kind: 'fat' | 'native',
): void {
  if (kind === 'fat') {
    for (let instance = 0; instance < start.count; instance++)
      writeDepthPlane(
        planes,
        instance * 4,
        start.getX(instance),
        start.getY(instance),
        start.getZ(instance),
        end.getX(instance),
        end.getY(instance),
        end.getZ(instance),
        offsets,
        instance,
        origins,
        instance * 4,
      );
  } else {
    for (let vertex = 0; vertex + 1 < start.count; vertex += 2) {
      const offset = vertex * 4;
      writeDepthPlane(
        planes,
        offset,
        start.getX(vertex),
        start.getY(vertex),
        start.getZ(vertex),
        end.getX(vertex + 1),
        end.getY(vertex + 1),
        end.getZ(vertex + 1),
        offsets,
        vertex,
        origins,
        offset,
      );
      planes.copyWithin(offset + 4, offset, offset + 4);
      offsets.copyWithin(vertex + 1, vertex, vertex + 1);
      origins.copyWithin(offset + 4, offset, offset + 4);
    }
  }
}

function depthAttribute(
  three: typeof ThreeNamespace,
  values: Float32Array,
  size: number,
  kind: 'fat' | 'native',
): ThreeNamespace.BufferAttribute {
  return kind === 'fat'
    ? new three.InstancedBufferAttribute(values, size)
    : new three.BufferAttribute(values, size);
}
