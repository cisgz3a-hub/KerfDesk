// A completed, hard screen-width capsule covers its own thinner ghost only
// while both drawings retain their original full source and physical plane.
import type * as ThreeNamespace from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import {
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  DEPTH_PLANE_ORIGIN_ATTRIBUTE,
} from './line-depth-plane-geometry';
import { SHOWN_ATTRIBUTE } from './program-lines';

type Attribute = ThreeNamespace.BufferAttribute | ThreeNamespace.InterleavedBufferAttribute;
const SOURCE_ATTRIBUTES = [
  'instanceStart',
  'instanceEnd',
  SHOWN_ATTRIBUTE,
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  DEPTH_PLANE_ORIGIN_ATTRIBUTE,
] as const;

/** This is a live draw-state guard, not a segment scan or a depth policy. */
export function coveredRampEligibility(
  three: typeof ThreeNamespace,
  lines: LineSegments2,
  ghost: LineSegments2,
  completedEnd: { readonly value: number },
): (
  renderer: ThreeNamespace.WebGLRenderer,
  geometry: ThreeNamespace.BufferGeometry,
  object: ThreeNamespace.Object3D,
) => boolean {
  const fullLines = lines.geometry;
  const fullGhost = ghost.geometry;
  const drawHook = Object.getPrototypeOf(lines).onBeforeRender as typeof lines.onBeforeRender;
  const sharedDrawHook = drawHook === Object.getPrototypeOf(ghost).onBeforeRender;
  const original = SOURCE_ATTRIBUTES.map((name) => fullLines.getAttribute(name));
  const solidTemplate = templateSnapshot(fullLines);
  const ghostTemplate = templateSnapshot(fullGhost);
  const sameTemplate = solidTemplate.every((entry, index) =>
    sameAttribute(entry.attribute, ghostTemplate[index]?.attribute),
  );
  const originalSource = () =>
    SOURCE_ATTRIBUTES.every((name, index) => {
      const attribute = original[index];
      return (
        attribute !== undefined &&
        fullLines.getAttribute(name) === attribute &&
        fullGhost.getAttribute(name) === attribute
      );
    });
  const originalFullDraw = (
    geometry: ThreeNamespace.BufferGeometry,
    object: ThreeNamespace.Object3D,
  ) =>
    geometry === fullGhost &&
    lines.geometry === fullLines &&
    object === ghost &&
    originalSource() &&
    sameTemplate &&
    unchangedTemplate(solidTemplate, fullLines) &&
    unchangedTemplate(ghostTemplate, fullGhost);
  return (renderer, geometry, object) =>
    originalFullDraw(geometry, object) &&
    sharedDrawHook &&
    lines.onBeforeRender === drawHook &&
    ghost.onBeforeRender === drawHook &&
    completedEnd.value <= fullLines.instanceCount &&
    sameDrawSpace(lines, ghost) &&
    opaqueCompleted(three, lines.material) &&
    lessGhost(three, ghost.material) &&
    lines.material.linewidth >= ghost.material.linewidth &&
    noClipping(renderer, lines, ghost);
}

function sameDrawSpace(lines: LineSegments2, ghost: LineSegments2): boolean {
  return (
    lines.visible &&
    ghost.visible &&
    lines.parent === ghost.parent &&
    lines.layers.mask === ghost.layers.mask &&
    lines.frustumCulled === ghost.frustumCulled &&
    lines.material.side === ghost.material.side &&
    // Three derives each draw's MV/normal from this world matrix and the same
    // current camera; LineSegments2 derives resolution from the current viewport.
    // Another object's cached MV/normal/resolution can still be from an old draw.
    lines.matrixWorld.equals(ghost.matrixWorld) &&
    sameBounds(lines, ghost)
  );
}

function sameBounds(lines: LineSegments2, ghost: LineSegments2): boolean {
  const solid = lines.geometry;
  const faint = ghost.geometry;
  return (
    solid.boundingSphere !== null &&
    faint.boundingSphere !== null &&
    solid.boundingSphere.equals(faint.boundingSphere) &&
    solid.boundingBox !== null &&
    faint.boundingBox !== null &&
    solid.boundingBox.equals(faint.boundingBox)
  );
}

function hardCaps(material: LineMaterial): boolean {
  return (
    material.visible &&
    !material.worldUnits &&
    !material.dashed &&
    !material.alphaToCoverage &&
    material.alphaTest === 0 &&
    !material.alphaHash &&
    !material.stencilWrite &&
    !material.polygonOffset &&
    Number.isFinite(material.linewidth) &&
    material.linewidth > 0
  );
}

function opaqueCompleted(three: typeof ThreeNamespace, material: LineMaterial): boolean {
  return (
    hardCaps(material) &&
    material.colorWrite &&
    !material.transparent &&
    material.opacity === 1 &&
    material.depthTest &&
    material.depthWrite &&
    material.depthFunc === three.LessEqualDepth
  );
}

function lessGhost(three: typeof ThreeNamespace, material: LineMaterial): boolean {
  return (
    hardCaps(material) &&
    material.transparent &&
    material.depthTest &&
    !material.depthWrite &&
    material.depthFunc === three.LessDepth
  );
}

function noClipping(
  renderer: ThreeNamespace.WebGLRenderer,
  lines: LineSegments2,
  ghost: LineSegments2,
): boolean {
  // The Inspector enables local clipping globally even with no active planes.
  return (
    renderer.clippingPlanes?.length === 0 &&
    (lines.material.clippingPlanes?.length ?? 0) === 0 &&
    (ghost.material.clippingPlanes?.length ?? 0) === 0
  );
}

function templateSnapshot(geometry: ThreeNamespace.BufferGeometry) {
  return ['position', 'uv', null].map((name) => {
    const attribute = name === null ? geometry.getIndex() : geometry.getAttribute(name);
    return { name, attribute, version: versionOf(attribute) };
  });
}

function versionOf(attribute: Attribute | null | undefined): number | undefined {
  if (!attribute) return undefined;
  return 'data' in attribute ? attribute.data.version : attribute.version;
}

function unchangedTemplate(
  snapshot: ReturnType<typeof templateSnapshot>,
  geometry: ThreeNamespace.BufferGeometry,
): boolean {
  return snapshot.every((entry) => {
    const current = entry.name === null ? geometry.getIndex() : geometry.getAttribute(entry.name);
    return entry.attribute === current && entry.version === versionOf(current);
  });
}

function sameAttribute(a: Attribute | null | undefined, b: Attribute | null | undefined): boolean {
  if (
    !a ||
    !b ||
    a.itemSize !== b.itemSize ||
    a.normalized !== b.normalized ||
    a.array.length !== b.array.length
  )
    return false;
  for (let index = 0; index < a.array.length; index += 1) {
    if (a.array[index] !== b.array[index]) return false;
  }
  return true;
}
