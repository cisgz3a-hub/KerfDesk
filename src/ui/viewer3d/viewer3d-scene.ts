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
import type { Viewer3dSegmentsInput } from './segment-buckets';
import {
  applyRecolor,
  applyReveal,
  buildToolpathObjects,
  setToolpathTravelVisibility,
  type RevealTargets,
  type ToolpathBuildArgs,
} from './scene-toolpath';
import { createCameraDirector } from './camera-director';
import type { CameraTracking } from './camera-tracking';
import { cameraPlacement, type CameraPreset } from './camera-presets';
import { createViewer3dRenderScheduler } from './create-viewer3d-render-scheduler';
import type { ArrowPlacement } from './direction-arrows';
import { createArrowMesh, disposeArrowMesh, type ArrowMesh } from './scene-arrows';
import { boundsExtent } from './scene-furniture';
import {
  createCameraRig,
  startRenderer,
  type CameraRig,
  type OrbitControlsCtor,
} from './scene-setup';
import {
  createMarkers,
  disposeMarkers,
  sizeMarkers,
  type MarkerMesh,
  type SceneMarkers,
} from './scene-markers';
import { buildFurniture, disposeChildren, frameCamera } from './scene-furniture';
import { resolveViewer3dTheme, type Viewer3dTheme } from './viewer3d-theme';
import { yieldViewer3dInitialization } from './yield-viewer3d-initialization';

export type Viewer3dSegments = Viewer3dSegmentsInput;

export type PlayheadMarker = {
  readonly hideMarker?: boolean;
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
  readonly setCameraTracking: (tracking: CameraTracking) => void;
  readonly onCameraInteraction: (listener: (() => void) | null) => void;
  /**
   * PNG data URL of the current frame. Renders and reads back in the SAME
   * task: without preserveDrawingBuffer the buffer is cleared at composite,
   * so a deferred read returns a blank image.
   */
  readonly captureImage: () => string;
  /** Direction arrowheads over the cut path; null clears them. */
  readonly setDirectionArrows: (placements: ReadonlyArray<ArrowPlacement> | null) => void;
  readonly resize: (width: number, height: number) => void;
  readonly requestRender: () => void;
  readonly dispose: () => void;
};

export type Viewer3dSceneResult =
  | { readonly kind: 'ok'; readonly handle: Viewer3dSceneHandle }
  | { readonly kind: 'no-webgl'; readonly reason: string };

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
  await yieldViewer3dInitialization();

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
  await yieldViewer3dInitialization();
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
  const renderScheduler = createViewer3dRenderScheduler({ render, renderChangeEvents: controls });
  const director = createCameraDirector({ ...deps.rig, render: renderScheduler.requestRender });

  // Fat-line materials size their strokes against the drawing buffer, so the
  // current view size is tracked and pushed into the material on resize.
  let viewWidth = deps.width;
  let viewHeight = deps.height;
  let fatMaterial: LineMaterialType | null = null;
  let travelObject: Object3D | null = null;
  let travelVisible = true;
  let reveal: RevealTargets | null = null;
  let lastBounds: AxisBounds | null = null;
  let arrowMesh: ArrowMesh | null = null;
  const markers = createMarkers(three, scene);
  const { marker, liveMarker } = markers;

  return {
    setCameraTracking: director.track,
    onCameraInteraction: director.onManual,
    setSegments: (segments) => {
      const built = rebuildToolpath(toolpathGroup, {
        ...modules,
        segments,
        theme,
        viewWidth,
        viewHeight,
        travelVisible,
      });
      ({ fatMaterial, travelObject, reveal } = built);
      sizeMarkers(markers, segments);
      renderScheduler.requestRender();
    },
    recolor: (colorOf) => void (applyRecolor(reveal, colorOf) && renderScheduler.requestRender()),
    setLiveMachine: (point) => (placeMarker(liveMarker, point), renderScheduler.requestRender()),
    setPlayhead: (playhead) => {
      applyReveal(reveal, playhead);
      placeMarker(marker, playhead?.hideMarker ? null : (playhead?.point ?? null));
      renderScheduler.requestRender();
    },
    fitToBounds: (bounds) => {
      lastBounds = bounds;
      director.setBounds(bounds);
      rebuildFurniture(three, furnitureGroup, bounds, theme);
      frameCamera(camera, controls, bounds);
      renderScheduler.requestRender();
    },
    setTravelVisible: (visible) => {
      travelVisible = visible;
      if (travelObject !== null) travelObject.visible = visible;
      setToolpathTravelVisibility(reveal, visible);
      renderScheduler.requestRender();
    },

    setDirectionArrows: (placements) => {
      arrowMesh = swapArrows(three, scene, arrowMesh, placements, boundsExtent(lastBounds), theme);
      renderScheduler.requestRender();
    },
    setView: (preset) => {
      director.stop();
      applyView(camera, controls, cameraPlacement(preset, lastBounds, camera.aspect));
      renderScheduler.requestRender();
    },
    captureImage: () => {
      renderScheduler.renderNow();
      return renderer.domElement.toDataURL('image/png');
    },
    resize: (nextWidth, nextHeight) => {
      if (nextWidth <= 0 || nextHeight <= 0) return;
      viewWidth = nextWidth;
      viewHeight = nextHeight;
      applyResize({ renderer, camera, fatMaterial }, nextWidth, nextHeight);
      renderScheduler.requestRender();
    },
    requestRender: renderScheduler.requestRender,
    dispose: () => {
      renderScheduler.dispose();
      director.dispose();
      disposeScene(deps, markers, arrowMesh);
    },
  };
}

function disposeScene(
  deps: SceneHandleDeps,
  markers: SceneMarkers,
  arrows: ArrowMesh | null,
): void {
  deps.rig.controls.dispose();
  disposeChildren(deps.toolpathGroup);
  disposeChildren(deps.furnitureGroup);
  disposeMarkers(deps.scene, markers);
  disposeArrowMesh(deps.scene, arrows);
  deps.renderer.dispose();
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

// Swap the bed/grid/triad for a new job extent.
function rebuildFurniture(
  three: ThreeModule,
  group: Object3D,
  bounds: AxisBounds | null,
  theme: Viewer3dTheme,
): void {
  disposeChildren(group);
  for (const object of buildFurniture(three, bounds, theme)) group.add(object);
}

// Replace the arrow overlay: the old instanced mesh is dead the moment the
// overlay is toggled or the program changes.
function swapArrows(
  three: ThreeModule,
  scene: ThreeNamespace.Scene,
  previous: ArrowMesh | null,
  placements: ReadonlyArray<ArrowPlacement> | null,
  extentMm: number,
  theme: Viewer3dTheme,
): ArrowMesh | null {
  disposeArrowMesh(scene, previous);
  if (placements === null) return null;
  const mesh = createArrowMesh(three, placements, extentMm, theme);
  if (mesh !== null) scene.add(mesh);
  return mesh;
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
