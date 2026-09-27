// The G-code scene's shared state and helpers (ADR-426 split from
// viewer3d-scene.ts): the render loop with its view cube and Studio labels,
// the camera controllers, markers, and the reporters the viewport listens to.
// The handle's methods in viewer3d-scene.ts all work through this.

import type * as ThreeNamespace from 'three';
import type { Object3D, WebGLRenderer } from 'three';
import type { LineMaterial as LineMaterialType } from 'three/examples/jsm/lines/LineMaterial.js';
import type { AxisBounds } from '../../core/gcode-view';
import { createCameraDirector } from './camera-director';
import type { Viewer3dProjection } from './camera-presets';
import {
  createViewer3dRenderScheduler,
  type Viewer3dRenderScheduler,
} from './create-viewer3d-render-scheduler';
import { disposeArrowMesh, type ArrowMesh } from './scene-arrows';
import { createSceneCameraControl, type SceneCameraControl } from './scene-camera';
import { boundsExtent, disposeChildren } from './scene-furniture';
import { createMarkers, disposeMarkers, type SceneMarkers } from './scene-markers';
import { placeMarker, type Point3 } from './scene-parts';
import type { CameraRig } from './scene-setup';
import { applyRecolor, type RevealTargets, type TravelLine } from './scene-toolpath';
import { applyTravelLook } from './scene-travel-look';
import { createViewCube, type ViewCube } from './scene-view-cube';
import { createStudioStage, type StudioStage } from './studio-stage';
import type { ThreeModules } from './viewer3d-modules';
import { CLASSIC_STAGE, srgbToLinear, type Viewer3dStage } from './viewer3d-look';
import type { Viewer3dTheme } from './viewer3d-theme';
import { createViewer3dFramePreparation } from './wait-for-viewer3d-gpu';
import { disposeViewer3dRenderer } from './viewer3d-context';

export type ColorOf = (segmentIndex: number) => readonly [number, number, number];

export type PlayheadMarker = {
  readonly hideMarker?: boolean;
  /** Reveal geometry through this segment; -1 hides everything. */
  readonly segmentIndex: number;
  /** Interpolated tool position, or null to hide the marker. */
  readonly point: Point3 | null;
};

export type SceneHandleDeps = {
  readonly modules: ThreeModules;
  readonly theme: Viewer3dTheme;
  readonly renderer: WebGLRenderer;
  readonly scene: ThreeNamespace.Scene;
  readonly canvas: HTMLCanvasElement;
  readonly toolpathGroup: Object3D;
  readonly furnitureGroup: Object3D;
  readonly rig: CameraRig;
  readonly width: number;
  readonly height: number;
};

// Mutable render state the handle's functions share.
export type SceneState = {
  viewWidth: number;
  viewHeight: number;
  fatMaterial: LineMaterialType | null;
  travelObject: Object3D | null;
  travelLine: TravelLine | null;
  travelVisible: boolean;
  reveal: RevealTargets | null;
  bounds: AxisBounds | null;
  arrowMesh: ArrowMesh | null;
  colorOf: ColorOf | null;
  playhead: PlayheadMarker | null;
  stage: Viewer3dStage;
  overlays: boolean;
};

type Listen<T> = (listener: ((value: T) => void) | null) => void;

export type SceneCore = {
  readonly deps: SceneHandleDeps;
  readonly state: SceneState;
  readonly cube: ViewCube;
  readonly studio: StudioStage;
  readonly scheduler: Viewer3dRenderScheduler;
  readonly requestRender: () => void;
  readonly preparation: ReturnType<typeof createViewer3dFramePreparation>;
  readonly director: ReturnType<typeof createCameraDirector>;
  readonly views: SceneCameraControl;
  readonly markers: SceneMarkers;
  readonly projection: { readonly listen: Listen<Viewer3dProjection>; readonly report: () => void };
  readonly moving: { readonly listen: Listen<boolean>; readonly dispose: () => void };
  /** Studio hands the line shaders linear colours; Classic keeps raw ones. */
  readonly encode: () => ((channel: number) => number) | undefined;
  /** The Classic marker, or Studio's tool model, at the playhead. */
  readonly placePlayhead: () => void;
  /** Re-applies the current lens after a look change. */
  readonly repaint: () => void;
  /** Dashed Studio rapids or Classic solid ones, sized to the job. */
  readonly applyTravel: () => void;
  readonly dispose: () => void;
};

export function createSceneCore(deps: SceneHandleDeps): SceneCore {
  const { modules, renderer, scene, rig } = deps;
  const { three } = modules;
  const state = initialState(deps);
  const cube = createViewCube(three);
  const studio = createStudioStage(modules, {
    renderer,
    scene,
    canvas: deps.canvas,
    classicObjects: [deps.furnitureGroup],
  });
  const drawFrame = (): void => {
    rig.controls.update();
    const camera = rig.viewCamera();
    renderer.render(scene, camera);
    if (state.overlays) cube.render(renderer, rig.camera, rig.controls.target);
    studio.renderLabels(camera);
  };
  const scheduler = createViewer3dRenderScheduler({
    render: drawFrame,
    renderChangeEvents: rig.controls,
  });
  const requestRender = scheduler.requestRender;
  const markers = createMarkers(three, scene);
  const encode = (): ((channel: number) => number) | undefined =>
    state.stage.look === 'studio' ? srgbToLinear : undefined;
  const core: Omit<SceneCore, 'dispose'> = {
    deps,
    state,
    cube,
    studio,
    scheduler,
    requestRender,
    preparation: createViewer3dFramePreparation(renderer.getContext(), scheduler),
    director: createCameraDirector({ ...rig, render: requestRender }),
    views: createSceneCameraControl(rig, requestRender),
    markers,
    projection: createProjectionReporter(rig),
    moving: createMovingReporter(rig.controls),
    encode,
    placePlayhead: () => {
      const point = state.playhead?.hideMarker ? null : (state.playhead?.point ?? null);
      placeMarker(markers.marker, studio.drawsTool() ? null : point);
      studio.placeTool(point);
    },
    repaint: () => {
      if (state.colorOf !== null) applyRecolor(state.reveal, state.colorOf, encode());
    },
    applyTravel: () =>
      applyTravelLook(
        three,
        state.travelLine,
        state.stage.look,
        deps.theme,
        boundsExtent(state.bounds),
      ),
  };
  return { ...core, dispose: () => disposeCore(core) };
}

function initialState(deps: SceneHandleDeps): SceneState {
  return {
    viewWidth: deps.width,
    viewHeight: deps.height,
    fatMaterial: null,
    travelObject: null,
    travelLine: null,
    travelVisible: true,
    reveal: null,
    bounds: null,
    arrowMesh: null,
    colorOf: null,
    playhead: null,
    stage: CLASSIC_STAGE,
    overlays: true,
  };
}

function disposeCore(core: Omit<SceneCore, 'dispose'>): void {
  const { deps } = core;
  core.preparation.dispose();
  core.scheduler.dispose();
  core.director.dispose();
  core.views.dispose();
  core.moving.dispose();
  deps.rig.controls.dispose();
  disposeChildren(deps.toolpathGroup);
  disposeChildren(deps.furnitureGroup);
  disposeMarkers(deps.scene, core.markers);
  disposeArrowMesh(deps.scene, core.state.arrowMesh);
  core.cube.dispose();
  core.studio.dispose();
  disposeViewer3dRenderer(deps.renderer);
}

// Tells the viewport which projection is showing, so its toggle stays true
// after a view change switched it automatically.
function createProjectionReporter(rig: CameraRig): SceneCore['projection'] {
  let listener: ((projection: Viewer3dProjection) => void) | null = null;
  return {
    listen: (next) => {
      listener = next;
      next?.(rig.getProjection());
    },
    report: () => listener?.(rig.getProjection()),
  };
}

// Overlays fade while the operator drags the camera (ADR-426).
function createMovingReporter(controls: CameraRig['controls']): SceneCore['moving'] {
  let listener: ((moving: boolean) => void) | null = null;
  const start = (): void => listener?.(true);
  const end = (): void => listener?.(false);
  controls.addEventListener('start', start);
  controls.addEventListener('end', end);
  return {
    listen: (next) => {
      listener = next;
    },
    dispose: () => {
      controls.removeEventListener('start', start);
      controls.removeEventListener('end', end);
      listener = null;
    },
  };
}
