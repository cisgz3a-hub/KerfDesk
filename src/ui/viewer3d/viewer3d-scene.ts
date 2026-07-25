// createViewer3dScene — the shared three.js scene shell (ADR-255 stage 3;
// ADR-102 §2 as amended: src/ui/viewer3d/ is a sanctioned three home).
// Z-up work-coordinate frame, DPR-correct rendering, orbit controls,
// bed/grid/origin furniture, render-on-demand, and complete disposal.

// Type-only imports: erased at compile time, so three itself still loads
// lazily through the dynamic import() below (ADR-102 §3).
import type * as ThreeNamespace from 'three';
import type { Object3D, PerspectiveCamera, WebGLRenderer } from 'three';
import type { LineMaterial as LineMaterialType } from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineMaterialModule from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineSegments2Module from 'three/examples/jsm/lines/LineSegments2.js';
import type * as LineSegmentsGeometryModule from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { AxisBounds } from '../../core/gcode-view';
import {
  buildSegmentBuckets,
  revealCount,
  type SegmentBuckets,
  type Viewer3dSegmentsInput,
} from './segment-buckets';
import { cameraPlacement, type CameraPreset } from './camera-presets';
import {
  createCameraRig,
  startRenderer,
  type CameraRig,
  type OrbitControlsCtor,
} from './scene-setup';
import { createMarkers, disposeMarkers, sizeMarkers, type MarkerMesh } from './scene-markers';
import { buildFurniture, disposeChildren, frameCamera } from './scene-furniture';
import { resolveViewer3dTheme, type Viewer3dTheme } from './viewer3d-theme';

export type Viewer3dSegments = Viewer3dSegmentsInput;

export type PlayheadMarker = {
  /** Reveal geometry through this segment; -1 hides everything. */
  readonly segmentIndex: number;
  /** Interpolated tool position, or null to hide the marker. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number } | null;
};

export type Viewer3dSceneHandle = {
  readonly setSegments: (segments: Viewer3dSegments) => void;
  readonly fitToBounds: (bounds: AxisBounds | null) => void;
  /** LightBurn's "show traversal moves" toggle. */
  readonly setTravelVisible: (visible: boolean) => void;
  /** Reveal up to the playhead and place the tool marker (null = show all). */
  readonly setPlayhead: (playhead: PlayheadMarker | null) => void;
  /**
   * Where the MACHINE actually is, from controller status (null hides it).
   * Drawn distinctly from the playback marker: one is a simulation, the
   * other is a live report, and confusing them would be dangerous.
   */
  readonly setLiveMachine: (
    point: { readonly x: number; readonly y: number; readonly z: number } | null,
  ) => void;
  /**
   * Recolour the drawn moves from a render-model-segment → rgb function.
   * Rewrites the existing colour attribute only — no geometry rebuild — so
   * switching data lenses is free (ADR-255 §11 R2).
   */
  readonly recolor: (colorOf: (segmentIndex: number) => readonly [number, number, number]) => void;
  /** Snap to a standard view (Top / Front / Right / Iso) framed on the job. */
  readonly setView: (preset: CameraPreset) => void;
  /**
   * PNG data URL of the current frame. Renders and reads back in the SAME
   * task: without preserveDrawingBuffer the buffer is cleared at composite,
   * so a deferred read returns a blank image.
   */
  readonly captureImage: () => string;
  readonly resize: (width: number, height: number) => void;
  readonly requestRender: () => void;
  readonly dispose: () => void;
};

export type Viewer3dSceneResult =
  | { readonly kind: 'ok'; readonly handle: Viewer3dSceneHandle }
  | { readonly kind: 'no-webgl'; readonly reason: string };

const TRAVEL_OPACITY = 0.45;
const FAT_LINE_PX = 2.5;

type ThreeModule = typeof ThreeNamespace;

type ThreeModules = {
  readonly three: ThreeModule;
  readonly OrbitControls: OrbitControlsCtor;
  readonly LineSegments2: typeof LineSegments2Module.LineSegments2;
  readonly LineSegmentsGeometry: typeof LineSegmentsGeometryModule.LineSegmentsGeometry;
  readonly LineMaterial: typeof LineMaterialModule.LineMaterial;
};

// Every three module the scene needs, loaded in one lazy chunk (ADR-102 §3).
async function loadThree(): Promise<ThreeModules> {
  const three = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const { LineSegments2 } = await import('three/examples/jsm/lines/LineSegments2.js');
  const { LineSegmentsGeometry } = await import('three/examples/jsm/lines/LineSegmentsGeometry.js');
  const { LineMaterial } = await import('three/examples/jsm/lines/LineMaterial.js');
  return { three, OrbitControls, LineSegments2, LineSegmentsGeometry, LineMaterial };
}

export async function createViewer3dScene(canvas: HTMLCanvasElement): Promise<Viewer3dSceneResult> {
  const modules = await loadThree();
  const { three, OrbitControls } = modules;
  const theme = resolveViewer3dTheme(canvas);

  const started = startRenderer(three, canvas, theme);
  if (started.kind === 'no-webgl') return started;
  const { renderer, width, height } = started;

  const scene = new three.Scene();
  const toolpathGroup = new three.Group();
  const furnitureGroup = new three.Group();
  scene.add(toolpathGroup);
  scene.add(furnitureGroup);

  const rig = createCameraRig(three, OrbitControls, { renderer, scene, canvas, width, height });
  const handle = createSceneHandle({
    modules,
    theme,
    renderer,
    scene,
    toolpathGroup,
    furnitureGroup,
    rig,
    width,
    height,
  });
  handle.fitToBounds(null);
  return { kind: 'ok', handle };
}

type SceneHandleDeps = {
  readonly modules: ThreeModules;
  readonly theme: Viewer3dTheme;
  readonly renderer: WebGLRenderer;
  readonly scene: ThreeNamespace.Scene;
  readonly toolpathGroup: Object3D;
  readonly furnitureGroup: Object3D;
  readonly rig: CameraRig;
  readonly width: number;
  readonly height: number;
};

// Owns the scene's mutable render state (current buffers, reveal targets,
// traversal visibility, view size) behind the handle's function surface.
function createSceneHandle(deps: SceneHandleDeps): Viewer3dSceneHandle {
  const { modules, theme, renderer, scene, toolpathGroup, furnitureGroup } = deps;
  const { three } = modules;
  const { camera, controls, render } = deps.rig;

  // Fat-line materials size their strokes against the drawing buffer, so the
  // current view size is tracked and pushed into the material on resize.
  let viewWidth = deps.width;
  let viewHeight = deps.height;
  let fatMaterial: LineMaterialType | null = null;
  let travelObject: Object3D | null = null;
  let travelVisible = true;
  let reveal: RevealTargets | null = null;
  let lastBounds: AxisBounds | null = null;
  const markers = createMarkers(three, scene);
  const { marker, liveMarker } = markers;

  return {
    setSegments: (segments) => {
      const built = rebuildToolpath(toolpathGroup, {
        ...modules,
        segments,
        theme,
        viewWidth,
        viewHeight,
        travelVisible,
      });
      ({ fatMaterial, travelObject } = built);
      reveal = built.reveal;
      sizeMarkers(markers, segments);
      render();
    },
    recolor: (colorOf) => {
      if (applyRecolor(reveal, colorOf)) render();
    },
    setLiveMachine: (point) => {
      placeMarker(liveMarker, point);
      render();
    },
    setPlayhead: (playhead) => {
      applyReveal(reveal, playhead);
      placeMarker(marker, playhead?.point ?? null);
      render();
    },
    fitToBounds: (bounds) => {
      lastBounds = bounds;
      disposeChildren(furnitureGroup);
      for (const object of buildFurniture(three, bounds, theme)) {
        furnitureGroup.add(object);
      }
      frameCamera(camera, controls, bounds);
      render();
    },
    setTravelVisible: (visible) => {
      travelVisible = visible;
      if (travelObject !== null) travelObject.visible = visible;
      render();
    },
    setView: (preset) => {
      applyView(camera, controls, cameraPlacement(preset, lastBounds));
      render();
    },
    captureImage: () => {
      render();
      return renderer.domElement.toDataURL('image/png');
    },
    resize: (nextWidth, nextHeight) => {
      if (nextWidth <= 0 || nextHeight <= 0) return;
      viewWidth = nextWidth;
      viewHeight = nextHeight;
      applyResize({ renderer, camera, fatMaterial }, nextWidth, nextHeight);
      render();
    },
    requestRender: render,
    dispose: () => {
      controls.removeEventListener('change', render);
      controls.dispose();
      disposeChildren(toolpathGroup);
      disposeChildren(furnitureGroup);
      disposeMarkers(scene, markers);
      renderer.dispose();
    },
  };
}

// Swap the drawn toolpath: dispose what was there, build the new batches,
// mount them. Disposal first — the old buffers are dead the moment the
// program changes.
function rebuildToolpath(
  group: Object3D,
  args: ToolpathBuildArgs,
): ReturnType<typeof buildToolpathObjects> {
  disposeChildren(group);
  const built = buildToolpathObjects(args);
  for (const object of built.objects) group.add(object);
  return built;
}

// Point the camera at a standard view and re-target the orbit controls.
function applyView(
  camera: PerspectiveCamera,
  controls: { target: { set: (x: number, y: number, z: number) => void }; update: () => void },
  view: ReturnType<typeof cameraPlacement>,
): void {
  camera.up.set(view.up.x, view.up.y, view.up.z);
  camera.position.set(view.position.x, view.position.y, view.position.z);
  controls.target.set(view.target.x, view.target.y, view.target.z);
  camera.lookAt(view.target.x, view.target.y, view.target.z);
  controls.update();
}

// Fat-line materials size their strokes against the drawing buffer, so the
// material's resolution has to track the canvas.
function applyResize(
  parts: {
    readonly renderer: WebGLRenderer;
    readonly camera: PerspectiveCamera;
    readonly fatMaterial: LineMaterialType | null;
  },
  width: number,
  height: number,
): void {
  parts.renderer.setSize(width, height, false);
  parts.camera.aspect = width / height;
  parts.camera.updateProjectionMatrix();
  parts.fatMaterial?.resolution.set(width, height);
}

// Show a marker at a point, or hide it when there is nothing to show.
function placeMarker(
  mesh: MarkerMesh,
  point: { readonly x: number; readonly y: number; readonly z: number } | null,
): void {
  mesh.visible = point !== null;
  if (point !== null) mesh.position.set(point.x, point.y, point.z);
}

type RevealTargets = {
  readonly solid: {
    // Narrow structural type rather than the addon class: only the instance
    // count (reveal) and colour upload (lenses) are ever touched.
    readonly geometry: {
      instanceCount: number;
      setColors: (colors: Float32Array) => unknown;
    };
    readonly total: number;
  } | null;
  readonly solidSource: Uint32Array;
  readonly travel: {
    readonly geometry: ThreeNamespace.BufferGeometry;
    readonly total: number;
  } | null;
  readonly travelSource: Uint32Array;
};

// Rewrites the solid batch's colour attribute in place from a render-model
// segment → rgb function. Returns whether anything was repainted.
function applyRecolor(
  targets: RevealTargets | null,
  colorOf: (segmentIndex: number) => readonly [number, number, number],
): boolean {
  if (targets?.solid == null) return false;
  const source = targets.solidSource;
  const colors = new Float32Array(source.length * 6);
  for (let entry = 0; entry < source.length; entry += 1) {
    const rgb = colorOf(source[entry] ?? 0);
    for (let end = 0; end < 2; end += 1) {
      const at = entry * 6 + end * 3;
      colors[at] = rgb[0];
      colors[at + 1] = rgb[1];
      colors[at + 2] = rgb[2];
    }
  }
  targets.solid.geometry.setColors(colors);
  return true;
}

// Reveal by draw count only — no buffer reallocation. Fat lines are instanced
// (one instance per segment), thin lines use setDrawRange over vertex pairs.
function applyReveal(targets: RevealTargets | null, playhead: PlayheadMarker | null): void {
  if (targets === null) return;
  const showAll = playhead === null;
  if (targets.solid !== null) {
    targets.solid.geometry.instanceCount = showAll
      ? targets.solid.total
      : revealCount(targets.solidSource, playhead.segmentIndex);
  }
  if (targets.travel !== null) {
    const count = showAll
      ? targets.travel.total
      : revealCount(targets.travelSource, playhead.segmentIndex);
    targets.travel.geometry.setDrawRange(0, count * 2);
  }
}

type ToolpathBuildArgs = {
  readonly three: ThreeModule;
  readonly LineSegments2: typeof LineSegments2Module.LineSegments2;
  readonly LineSegmentsGeometry: typeof LineSegmentsGeometryModule.LineSegmentsGeometry;
  readonly LineMaterial: typeof LineMaterialModule.LineMaterial;
  readonly segments: Viewer3dSegments;
  readonly theme: Viewer3dTheme;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly travelVisible: boolean;
};

// Solid moves render as vertex-colored fat lines (one batch, per-kind color);
// traversal stays a thin translucent line object under them (LightBurn's
// recessive-rapid convention), toggleable without a geometry rebuild.
function buildToolpathObjects(args: ToolpathBuildArgs): {
  readonly objects: ReadonlyArray<Object3D>;
  readonly fatMaterial: LineMaterialType | null;
  readonly travelObject: Object3D | null;
  readonly reveal: RevealTargets;
} {
  const buckets = buildSegmentBuckets(args.segments, args.theme);
  const objects: Object3D[] = [];
  let fatMaterial: LineMaterialType | null = null;
  let travelObject: Object3D | null = null;
  let solidTarget: RevealTargets['solid'] = null;
  let travelTarget: RevealTargets['travel'] = null;
  if (buckets.solid.count > 0) {
    const geometry = new args.LineSegmentsGeometry();
    geometry.setPositions(buckets.solid.positions);
    geometry.setColors(buckets.solid.colors);
    fatMaterial = new args.LineMaterial({ vertexColors: true, linewidth: FAT_LINE_PX });
    fatMaterial.resolution.set(args.viewWidth, args.viewHeight);
    const lines = new args.LineSegments2(geometry, fatMaterial);
    lines.renderOrder = 1;
    objects.push(lines);
    solidTarget = { geometry, total: buckets.solid.count };
  }
  if (buckets.travel.count > 0) {
    const travel = lineSegmentsObject(
      args.three,
      buckets.travel.positions,
      args.theme.travel,
      TRAVEL_OPACITY,
      0,
    );
    travel.visible = args.travelVisible;
    travelObject = travel;
    objects.push(travel);
    travelTarget = { geometry: travel.geometry, total: buckets.travel.count };
  }
  return {
    objects,
    fatMaterial,
    travelObject,
    reveal: revealTargets(buckets, solidTarget, travelTarget),
  };
}

function revealTargets(
  buckets: SegmentBuckets,
  solid: RevealTargets['solid'],
  travel: RevealTargets['travel'],
): RevealTargets {
  return {
    solid,
    solidSource: buckets.solid.sourceIndex,
    travel,
    travelSource: buckets.travel.sourceIndex,
  };
}

function lineSegmentsObject(
  three: ThreeModule,
  positions: Float32Array,
  color: number,
  opacity: number,
  renderOrder: number,
): ThreeNamespace.LineSegments<ThreeNamespace.BufferGeometry, ThreeNamespace.LineBasicMaterial> {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.BufferAttribute(positions, 3));
  const material = new three.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  });
  const lines = new three.LineSegments(geometry, material);
  lines.renderOrder = renderOrder;
  return lines;
}
