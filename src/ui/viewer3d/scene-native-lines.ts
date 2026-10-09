// Native traversal construction, shared by completed and ghost draws.
import type * as ThreeNamespace from 'three';
import { installXYPlaneDepth } from './line-plane-depth';
import {
  addDepthPlanes,
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  DEPTH_PLANE_ORIGIN_ATTRIBUTE,
} from './line-depth-plane-geometry';

type ThreeModule = typeof ThreeNamespace;

export function lineSegmentsObject(
  three: ThreeModule,
  positions: Float32Array,
  color: number,
  opacity: number,
  renderOrder: number,
  sharedGeometry?: ThreeNamespace.BufferGeometry,
): ThreeNamespace.LineSegments<ThreeNamespace.BufferGeometry, ThreeNamespace.LineBasicMaterial> {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute(
    'position',
    sharedGeometry?.getAttribute('position') ?? new three.BufferAttribute(positions, 3),
  );
  const material = new three.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    toneMapped: false,
    depthWrite: false,
    depthFunc: three.LessDepth,
  });
  if (sharedGeometry) {
    geometry.setAttribute(
      DEPTH_PLANE_ATTRIBUTE,
      sharedGeometry.getAttribute(DEPTH_PLANE_ATTRIBUTE),
    );
    geometry.setAttribute(
      DEPTH_PLANE_OFFSET_ATTRIBUTE,
      sharedGeometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE),
    );
    geometry.setAttribute(
      DEPTH_PLANE_ORIGIN_ATTRIBUTE,
      sharedGeometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE),
    );
  } else addDepthPlanes(three, geometry, 'native');
  installXYPlaneDepth(three, material, 'native');
  const lines = new three.LineSegments(geometry, material);
  lines.renderOrder = renderOrder;
  return lines;
}
