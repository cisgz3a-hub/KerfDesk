// Pointing at a move (ADR-470). The pick pass draws the thin copy of every
// move into a small square around the pointer, each move in a colour that
// spells its segment index, and reads the square back. That costs one tiny
// draw per pointer update however long the program is, and it respects what
// is in front: the move the operator sees under the pointer is the one named.
// The hovered move is then outlined over the rest of the path.

import type * as ThreeNamespace from 'three';
import type { WebGLRenderer } from 'three';
import { encodePickIds, nearestEnd, nearestPickedSegment, PICK_WINDOW_PX } from './pick-ids';
import type { Point3 } from './scene-parts';
import type { ViewCamera } from './scene-setup';
import type { RevealTargets } from './scene-toolpath';
import type { ThreeModules } from './viewer3d-modules';

type ThreeModule = typeof ThreeNamespace;

export type Viewer3dPick = {
  /** Render-model segment under the pointer. */
  readonly segmentIndex: number;
  /** 0 to 1 along the move, where it passes closest to the pointer. */
  readonly fraction: number;
  /** That closest point, in work coordinates (mm). */
  readonly point: Point3;
  /** The move's end nearest the pointer when it is within a snap distance. */
  readonly vertex: Point3 | null;
};

/** Where the pointer is over a view of the given size, in CSS pixels. */
export type PickPointer = {
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
};

export type ToolpathPicker = {
  /** The newly built toolpath; the pick copy is made on the first pick. */
  readonly setTargets: (targets: RevealTargets | null) => void;
  readonly pick: (camera: ViewCamera, pointer: PickPointer) => Viewer3dPick | null;
  /** Outlines one move; returns whether anything changed. */
  readonly highlight: (segmentIndex: number | null) => boolean;
  readonly resize: (width: number, height: number) => void;
  /** Clips the pick pass and the outline like the drawn toolpath. */
  readonly setClipPlanes: (planes: ThreeNamespace.Plane[] | null) => void;
  readonly dispose: () => void;
};

const HIGHLIGHT_CORE = 0x38e1ff;
const HIGHLIGHT_CASING = 0x0d0f12;
const HIGHLIGHT_CORE_PX = 3.5;
const HIGHLIGHT_CASING_PX = 8;
// Over the toolpath (1), the Studio tool model and the view cube's scene.
const HIGHLIGHT_RENDER_ORDER = 6;
const PICK_ATTRIBUTE = 'pickId';

const PICK_VERTEX = /* glsl */ `
attribute vec4 pickId;
flat varying vec4 vPickId;
#include <clipping_planes_pars_vertex>
void main() {
  vPickId = pickId;
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
}
`;

const PICK_FRAGMENT = /* glsl */ `
flat varying vec4 vPickId;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vPickId;
}
`;

export function createToolpathPicker(
  modules: ThreeModules,
  deps: {
    readonly renderer: WebGLRenderer;
    readonly scene: ThreeNamespace.Scene;
    readonly width: number;
    readonly height: number;
  },
): ToolpathPicker {
  const { three } = modules;
  const pass = createPickPass(three, deps.renderer);
  const outline = createOutline(modules, deps);
  let targets: RevealTargets | null = null;
  let travelPick: ThreeNamespace.LineSegments | null = null;
  let built = false;
  return {
    setTargets: (next) => {
      pass.clear();
      travelPick = null;
      built = false;
      targets = next;
      outline.show(null, null);
    },
    pick: (camera, pointer) => {
      if (targets === null) return null;
      if (!built) {
        built = true;
        pass.add(targets.solidGhost, targets.solidSource);
        travelPick = pass.add(targets.travelGhost, targets.travelSource);
      }
      if (travelPick !== null) travelPick.visible = targets.travelVisible;
      const segmentIndex = pass.read(camera, pointer);
      if (segmentIndex === null) return null;
      return closestOnMove(three, camera, pointer, targets.positions, segmentIndex);
    },
    highlight: (segmentIndex) => outline.show(segmentIndex, targets?.positions ?? null),
    resize: outline.resize,
    setClipPlanes: (planes) => {
      pass.material.clippingPlanes = planes;
      outline.setClipPlanes(planes);
    },
    dispose: () => {
      pass.dispose();
      outline.dispose();
    },
  };
}

type PickPass = {
  readonly add: (
    ghost: RevealTargets['solidGhost'],
    source: Uint32Array,
  ) => ThreeNamespace.LineSegments | null;
  readonly read: (camera: ViewCamera, pointer: PickPointer) => number | null;
  readonly material: ThreeNamespace.ShaderMaterial;
  readonly clear: () => void;
  readonly dispose: () => void;
};

// The ID scene shares the ghost lines' geometry, so it costs one extra
// attribute and no second copy of the positions. The toolpath rebuild
// disposes that geometry; `clear` only lets go of it.
function createPickPass(three: ThreeModule, renderer: WebGLRenderer): PickPass {
  const scene = new three.Scene();
  const target = new three.WebGLRenderTarget(PICK_WINDOW_PX, PICK_WINDOW_PX);
  const pixels = new Uint8Array(PICK_WINDOW_PX * PICK_WINDOW_PX * 4);
  const material = new three.ShaderMaterial({
    vertexShader: PICK_VERTEX,
    fragmentShader: PICK_FRAGMENT,
    blending: three.NoBlending,
    toneMapped: false,
    clipping: true,
  });
  const savedClear = new three.Color();
  const half = (PICK_WINDOW_PX - 1) / 2;
  return {
    material,
    add: (ghost, source) => {
      if (ghost === null) return null;
      const ids = new three.BufferAttribute(encodePickIds(source), 4, true);
      ghost.geometry.setAttribute(PICK_ATTRIBUTE, ids);
      const lines = new three.LineSegments(ghost.geometry, material);
      lines.frustumCulled = false;
      scene.add(lines);
      return lines;
    },
    read: (camera, pointer) => {
      const left = Math.round(pointer.xPx) - half;
      const top = Math.round(pointer.yPx) - half;
      camera.setViewOffset(
        pointer.widthPx,
        pointer.heightPx,
        left,
        top,
        PICK_WINDOW_PX,
        PICK_WINDOW_PX,
      );
      const previousTarget = renderer.getRenderTarget();
      renderer.getClearColor(savedClear);
      const savedAlpha = renderer.getClearAlpha();
      try {
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, PICK_WINDOW_PX, PICK_WINDOW_PX, pixels);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(savedClear, savedAlpha);
        camera.clearViewOffset();
      }
      return nearestPickedSegment(pixels, PICK_WINDOW_PX);
    },
    clear: () => scene.clear(),
    dispose: () => {
      scene.clear();
      material.dispose();
      target.dispose();
    },
  };
}

// The point of the picked move nearest the pointer's ray. An orthographic ray
// starts on the near plane, which this rig puts behind the camera, so moves
// between the two still measure correctly.
function closestOnMove(
  three: ThreeModule,
  camera: ViewCamera,
  pointer: PickPointer,
  positions: Float32Array,
  segmentIndex: number,
): Viewer3dPick {
  const ndc = new three.Vector2(
    (pointer.xPx / Math.max(1, pointer.widthPx)) * 2 - 1,
    1 - (pointer.yPx / Math.max(1, pointer.heightPx)) * 2,
  );
  const raycaster = new three.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  if ('isOrthographicCamera' in camera) {
    raycaster.ray.origin.set(ndc.x, ndc.y, -1).unproject(camera);
  }
  const start = new three.Vector3().fromArray(positions, segmentIndex * 6);
  const end = new three.Vector3().fromArray(positions, segmentIndex * 6 + 3);
  const onMove = new three.Vector3();
  raycaster.ray.distanceSqToSegment(start, end, undefined, onMove);
  const length = start.distanceTo(end);
  const fraction = length > 0 ? Math.min(1, Math.max(0, start.distanceTo(onMove) / length)) : 1;
  const onScreen = (point: ThreeNamespace.Vector3): { x: number; y: number } | null => {
    const projected = point.clone().project(camera);
    if (!Number.isFinite(projected.x) || Math.abs(projected.z) > 1) return null;
    return {
      x: ((projected.x + 1) / 2) * pointer.widthPx,
      y: ((1 - projected.y) / 2) * pointer.heightPx,
    };
  };
  const snap = nearestEnd({ x: pointer.xPx, y: pointer.yPx }, onScreen(start), onScreen(end));
  const vertex = snap === null ? null : snap === 'start' ? start : end;
  return {
    segmentIndex,
    fraction,
    point: { x: onMove.x, y: onMove.y, z: onMove.z },
    vertex: vertex === null ? null : { x: vertex.x, y: vertex.y, z: vertex.z },
  };
}

type Outline = {
  readonly show: (segmentIndex: number | null, positions: Float32Array | null) => boolean;
  readonly resize: (width: number, height: number) => void;
  readonly setClipPlanes: (planes: ThreeNamespace.Plane[] | null) => void;
  readonly dispose: () => void;
};

// A bright cyan stroke in a dark casing over the hovered move, drawn on top
// of everything. Cyan is no move kind's or lens's colour, and the casing
// keeps it readable over Classic's pale lines as well as Studio's warm ones.
function createOutline(
  modules: ThreeModules,
  deps: Parameters<typeof createToolpathPicker>[1],
): Outline {
  const geometry = new modules.LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(6));
  const strokes = [
    { color: HIGHLIGHT_CASING, linewidth: HIGHLIGHT_CASING_PX, opacity: 0.85 },
    { color: HIGHLIGHT_CORE, linewidth: HIGHLIGHT_CORE_PX, opacity: 1 },
  ].map((stroke, order) => {
    const material = new modules.LineMaterial({
      ...stroke,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    material.toneMapped = false;
    material.resolution.set(deps.width, deps.height);
    const line = new modules.LineSegments2(geometry, material);
    line.renderOrder = HIGHLIGHT_RENDER_ORDER + order;
    line.visible = false;
    deps.scene.add(line);
    return { line, material };
  });
  let shown: number | null = null;
  return {
    show: (segmentIndex, positions) => {
      const next = positions === null ? null : segmentIndex;
      if (next === shown) return false;
      shown = next;
      if (next !== null && positions !== null) {
        geometry.setPositions(positions.subarray(next * 6, next * 6 + 6));
      }
      for (const { line } of strokes) line.visible = next !== null;
      return true;
    },
    resize: (width, height) => {
      for (const { material } of strokes) material.resolution.set(width, height);
    },
    setClipPlanes: (planes) => {
      for (const { material } of strokes) material.clippingPlanes = planes;
    },
    dispose: () => {
      for (const { line, material } of strokes) {
        deps.scene.remove(line);
        material.dispose();
      }
      geometry.dispose();
    },
  };
}
