// createViewer3dScene — the shared three.js scene shell (ADR-255 stage 3;
// ADR-102 §2 as amended: src/ui/viewer3d/ is a sanctioned three home).
// Z-up work-coordinate frame, DPR-correct rendering, orbit controls,
// bed/grid/origin furniture, render-on-demand, and complete disposal.
// ADR-426 adds orthographic views, the view cube and the Studio look.

import type { AxisBounds } from '../../core/gcode-view';
import type { Viewer3dSegmentsInput } from './segment-buckets';
import { applyRecolor, applyReveal, setToolpathTravelVisibility } from './scene-toolpath';
import type { CameraTracking } from './camera-tracking';
import type { Viewer3dProjection, Viewer3dView } from './camera-presets';
import type { ArrowPlacement } from './direction-arrows';
import { boundsExtent } from './scene-furniture';
import {
  createSceneCore,
  type ColorOf,
  type PlayheadMarker,
  type SceneCore,
  type SceneHandleDeps,
} from './scene-handle-core';
import { createCameraRig, startRenderer } from './scene-setup';
import { sizeMarkers } from './scene-markers';
import {
  applyResize,
  captureFrame,
  placeMarker,
  rebuildFurniture,
  rebuildToolpath,
  swapArrows,
  type Point3,
} from './scene-parts';
import { loadThree } from './viewer3d-modules';
import { toThreePlanes, type Viewer3dClipPlane } from './scene-isolate';
import type { Viewer3dMeasure } from './scene-measure';
import { disposeDetail, type Viewer3dDetail } from './scene-detail';
import type { Viewer3dPick } from './scene-pick';
import type { Viewer3dStage } from './viewer3d-look';
import { createStockView, type Viewer3dStock } from './scene-stock';
import { resolveViewer3dTheme } from './viewer3d-theme';
import { yieldViewer3dInitialization } from './yield-viewer3d-initialization';

export type Viewer3dSegments = Viewer3dSegmentsInput;

export type { PlayheadMarker } from './scene-handle-core';
export type { Viewer3dPick } from './scene-pick';
export type { Viewer3dClipPlane } from './scene-isolate';
export type { Viewer3dMeasure } from './scene-measure';
export type { Viewer3dDetail } from './scene-detail';
export type { Viewer3dStock } from './scene-stock';

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
  readonly setLiveMachine: (point: Point3 | null) => void;
  /**
   * Recolour the drawn moves from a render-model-segment → rgb function.
   * Rewrites the existing colour attribute only — no geometry rebuild — so
   * switching data lenses is free (ADR-255 §11 R2).
   */
  readonly recolor: (colorOf: ColorOf) => void;
  /** Turn to a named view, drawn orthographically unless it is Iso (ADR-426). */
  readonly setView: (view: Viewer3dView) => void;
  /** Frame the whole job from the current angle. */
  readonly fitView: () => void;
  readonly setProjection: (projection: Viewer3dProjection) => void;
  /** Reports each projection change, including the automatic ones. */
  readonly onProjectionChange: (
    listener: ((projection: Viewer3dProjection) => void) | null,
  ) => void;
  /** Classic or Studio, with the job box, work area and tool Studio draws. */
  readonly setStage: (stage: Viewer3dStage) => void;
  /** The view cube face under a point in its square (fractions, 0,0 top-left). */
  readonly pickViewCube: (xFraction: number, yFraction: number) => Viewer3dView | null;
  readonly hoverViewCube: (view: Viewer3dView | null) => void;
  readonly setCameraTracking: (tracking: CameraTracking) => void;
  readonly onCameraInteraction: (listener: (() => void) | null) => void;
  /**
   * Reports whether the drawn path is simplified for the zoom, and how; null
   * when every move is drawn (ADR-485).
   */
  readonly onDetailChange: (listener: ((detail: Viewer3dDetail | null) => void) | null) => void;
  /** Reports orbit, pan and zoom drags starting (true) and ending (false). */
  readonly onCameraMoving: (listener: ((moving: boolean) => void) | null) => void;
  /**
   * PNG data URL of the current frame. Renders and reads back in the SAME
   * task: without preserveDrawingBuffer the buffer is cleared at composite,
   * so a deferred read returns a blank image. The view cube is left out.
   */
  readonly captureImage: () => string;
  /**
   * The move drawn under a point of the canvas (CSS pixels from its top-left),
   * with the point on it nearest the pointer; null over empty space (ADR-470).
   */
  readonly pickMove: (xPx: number, yPx: number) => Viewer3dPick | null;
  /** Outlines one move over the rest of the path; null clears it. */
  readonly highlightMove: (segmentIndex: number | null) => void;
  /**
   * Leaves out every move whose entry is 0, for the legend's filters; null
   * draws every move. A new program clears it (ADR-470).
   */
  readonly setMoveFilter: (visible: Uint8Array | null) => void;
  /** Clips the toolpath to the kept side of each plane; none draws it whole. */
  readonly setClipPlanes: (planes: ReadonlyArray<Viewer3dClipPlane>) => void;
  /** Draws a measurement between two points; null clears it (ADR-470). */
  readonly setMeasure: (measure: Viewer3dMeasure | null) => void;
  /** The carved stock, in the program's frame; null removes it (ADR-487). */
  readonly setStock: (stock: Viewer3dStock | null) => void;
  /** The stock's depths changed in place. */
  readonly updateStock: () => void;
  /** Shows or hides the drawn toolpath, as over the carved stock. */
  readonly setToolpathVisible: (visible: boolean) => void;
  /** Direction arrowheads over the cut path; null clears them. */
  readonly setDirectionArrows: (placements: ReadonlyArray<ArrowPlacement> | null) => void;
  readonly resize: (width: number, height: number) => void;
  readonly requestRender: () => void;
  /** Completes the current hidden frame before the Inspector makes it visible. */
  readonly prepareToShow: (signal?: AbortSignal) => Promise<void>;
  readonly dispose: () => void;
};

export type Viewer3dSceneResult =
  | { readonly kind: 'ok'; readonly handle: Viewer3dSceneHandle }
  | { readonly kind: 'no-webgl'; readonly reason: string };

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
    canvas,
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

// The handle's methods, grouped by what they touch, over one shared core.
function createSceneHandle(deps: SceneHandleDeps): Viewer3dSceneHandle {
  const core = createSceneCore(deps);
  const toolpath = toolpathMethods(core);
  const camera = cameraMethods(core);
  const lifecycle = lifecycleMethods(core);
  const stock = createStockView(deps.modules.three, deps.scene, deps.furnitureGroup);
  return {
    ...toolpath,
    ...camera,
    ...lifecycle,
    ...isolateMethods(core),
    fitToBounds: (bounds) => {
      camera.fitToBounds(bounds);
      stock.placeGrid();
    },
    setStage: (stage) => {
      stock.setLook(stage.look);
      toolpath.setStage(stage);
    },
    setStock: (next) => (stock.set(next), core.requestRender()),
    updateStock: () => (stock.update(), core.requestRender()),
    setToolpathVisible: (visible) => {
      deps.toolpathGroup.visible = visible;
      core.requestRender();
    },
    dispose: () => {
      stock.dispose();
      lifecycle.dispose();
    },
  };
}

// Builds the drawn toolpath from the installed program and the move filter.
function installToolpath(core: SceneCore): void {
  const { deps, state } = core;
  if (state.segments === null) return;
  disposeDetail(state.reveal?.detail ?? null);
  const built = rebuildToolpath(deps.toolpathGroup, {
    ...deps.modules,
    segments: { ...state.segments, visible: state.moveFilter },
    theme: deps.theme,
    viewWidth: state.viewWidth,
    viewHeight: state.viewHeight,
    travelVisible: state.travelVisible,
  });
  state.fatMaterials = built.fatMaterials;
  state.travelObject = built.travelObject;
  state.travelLine = built.travelLine;
  state.reveal = built.reveal;
  core.picker.setTargets(built.reveal);
  core.applyTravel();
}

type IsolateMethods = Pick<
  Viewer3dSceneHandle,
  'pickMove' | 'highlightMove' | 'setMoveFilter' | 'setClipPlanes' | 'setMeasure'
>;

function isolateMethods(core: SceneCore): IsolateMethods {
  const { deps, state } = core;
  return {
    setMoveFilter: (visible) => {
      if (state.segments === null || visible === state.moveFilter) return;
      state.moveFilter = visible;
      installToolpath(core);
      core.repaint();
      applyReveal(state.reveal, state.playhead);
      core.requestRender();
    },
    setClipPlanes: (planes) => {
      state.clipPlanes = toThreePlanes(deps.modules.three, planes);
      core.applyClipping();
      core.requestRender();
    },
    setMeasure: (measure) => {
      core.measure.set(measure);
      core.requestRender();
    },
    pickMove: (xPx, yPx) =>
      core.picker.pick(deps.rig.viewCamera(), {
        xPx,
        yPx,
        widthPx: state.viewWidth,
        heightPx: state.viewHeight,
      }),
    highlightMove: (segmentIndex) => {
      if (core.picker.highlight(segmentIndex)) core.requestRender();
    },
  };
}

type ToolpathMethods = Pick<
  Viewer3dSceneHandle,
  | 'setSegments'
  | 'recolor'
  | 'setLiveMachine'
  | 'setPlayhead'
  | 'setTravelVisible'
  | 'setStage'
  | 'setDirectionArrows'
>;

function toolpathMethods(core: SceneCore): ToolpathMethods {
  const { deps, state, markers, requestRender } = core;
  const { modules, theme } = deps;
  return {
    setSegments: (segments) => {
      state.segments = segments;
      state.moveFilter = null;
      installToolpath(core);
      sizeMarkers(markers, segments);
      requestRender();
    },
    recolor: (colorOf) => {
      state.colorOf = colorOf;
      if (applyRecolor(state.reveal, colorOf, core.encode())) requestRender();
    },
    setLiveMachine: (point) => (placeMarker(markers.liveMarker, point), requestRender()),
    setPlayhead: (playhead) => {
      state.playhead = playhead;
      applyReveal(state.reveal, playhead);
      core.placePlayhead();
      requestRender();
    },
    setTravelVisible: (visible) => {
      state.travelVisible = visible;
      if (state.travelObject !== null) state.travelObject.visible = visible;
      setToolpathTravelVisibility(state.reveal, visible);
      requestRender();
    },
    setStage: (stage) => {
      const lookChanged = stage.look !== state.stage.look;
      state.stage = stage;
      core.studio.setStage(stage, state.bounds);
      core.applyTravel();
      if (lookChanged) core.repaint();
      core.placePlayhead();
      requestRender();
    },
    setDirectionArrows: (placements) => {
      const extent = boundsExtent(state.bounds);
      const { three } = modules;
      state.arrowMesh = swapArrows(three, deps.scene, state.arrowMesh, placements, extent, theme);
      core.applyClipping();
      requestRender();
    },
  };
}

type CameraMethods = Pick<
  Viewer3dSceneHandle,
  | 'setCameraTracking'
  | 'onCameraInteraction'
  | 'onCameraMoving'
  | 'onDetailChange'
  | 'onProjectionChange'
  | 'fitToBounds'
  | 'setView'
  | 'fitView'
  | 'setProjection'
  | 'pickViewCube'
  | 'hoverViewCube'
>;

function cameraMethods(core: SceneCore): CameraMethods {
  const { deps, state, director, views, projection, requestRender } = core;
  return {
    setCameraTracking: director.track,
    onCameraInteraction: director.onManual,
    onCameraMoving: core.moving.listen,
    onDetailChange: core.detail.listen,
    onProjectionChange: projection.listen,
    fitToBounds: (bounds) => {
      state.bounds = bounds;
      director.setBounds(bounds);
      views.setBounds(bounds);
      rebuildFurniture(deps.modules.three, deps.furnitureGroup, bounds, deps.theme);
      core.studio.setStage(state.stage, bounds);
      core.applyTravel();
      views.frame();
      projection.report();
      requestRender();
    },
    setView: (view) => {
      director.stop();
      views.goToView(view);
      projection.report();
    },
    fitView: () => {
      director.stop();
      views.fit();
    },
    setProjection: (next) => {
      views.setProjection(next);
      projection.report();
    },
    pickViewCube: core.cube.pick,
    hoverViewCube: (view) => {
      if (core.cube.hover(view)) requestRender();
    },
  };
}

type LifecycleMethods = Pick<
  Viewer3dSceneHandle,
  'captureImage' | 'resize' | 'requestRender' | 'prepareToShow' | 'dispose'
>;

function lifecycleMethods(core: SceneCore): LifecycleMethods {
  const { deps, state, requestRender } = core;
  return {
    captureImage: () => {
      state.overlays = false;
      try {
        return captureFrame(core.scheduler, deps.renderer);
      } finally {
        state.overlays = true;
        requestRender();
      }
    },
    resize: (nextWidth, nextHeight) => {
      if (nextWidth <= 0 || nextHeight <= 0) return;
      state.viewWidth = nextWidth;
      state.viewHeight = nextHeight;
      const parts = {
        renderer: deps.renderer,
        camera: deps.rig.camera,
        fatMaterials: state.fatMaterials,
      };
      applyResize(parts, nextWidth, nextHeight);
      core.studio.resize(nextWidth, nextHeight);
      core.picker.resize(nextWidth, nextHeight);
      core.measure.resize(nextWidth, nextHeight);
      requestRender();
    },
    requestRender,
    prepareToShow: core.preparation.prepareToShow,
    dispose: core.dispose,
  };
}
