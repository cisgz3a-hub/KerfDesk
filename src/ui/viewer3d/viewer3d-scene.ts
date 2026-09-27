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
import type { Viewer3dStage } from './viewer3d-look';
import { resolveViewer3dTheme } from './viewer3d-theme';
import { yieldViewer3dInitialization } from './yield-viewer3d-initialization';

export type Viewer3dSegments = Viewer3dSegmentsInput;

export type { PlayheadMarker } from './scene-handle-core';

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
  /** Reports orbit, pan and zoom drags starting (true) and ending (false). */
  readonly onCameraMoving: (listener: ((moving: boolean) => void) | null) => void;
  /**
   * PNG data URL of the current frame. Renders and reads back in the SAME
   * task: without preserveDrawingBuffer the buffer is cleared at composite,
   * so a deferred read returns a blank image. The view cube is left out.
   */
  readonly captureImage: () => string;
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
  return {
    ...toolpathMethods(core),
    ...cameraMethods(core),
    ...lifecycleMethods(core),
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
      const built = rebuildToolpath(deps.toolpathGroup, {
        ...modules,
        segments,
        theme,
        viewWidth: state.viewWidth,
        viewHeight: state.viewHeight,
        travelVisible: state.travelVisible,
      });
      state.fatMaterial = built.fatMaterial;
      state.travelObject = built.travelObject;
      state.travelLine = built.travelLine;
      state.reveal = built.reveal;
      core.applyTravel();
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
      requestRender();
    },
  };
}

type CameraMethods = Pick<
  Viewer3dSceneHandle,
  | 'setCameraTracking'
  | 'onCameraInteraction'
  | 'onCameraMoving'
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
        fatMaterial: state.fatMaterial,
      };
      applyResize(parts, nextWidth, nextHeight);
      core.studio.resize(nextWidth, nextHeight);
      requestRender();
    },
    requestRender,
    prepareToShow: core.preparation.prepareToShow,
    dispose: core.dispose,
  };
}
