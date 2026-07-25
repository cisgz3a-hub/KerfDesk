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
import type * as OrbitControlsModule from 'three/examples/jsm/controls/OrbitControls.js';
import type { AxisBounds } from '../../core/gcode-view';
import {
  buildSegmentBuckets,
  revealCount,
  type SegmentBuckets,
  type Viewer3dSegmentsInput,
} from './segment-buckets';
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
  readonly resize: (width: number, height: number) => void;
  readonly requestRender: () => void;
  readonly dispose: () => void;
};

export type Viewer3dSceneResult =
  | { readonly kind: 'ok'; readonly handle: Viewer3dSceneHandle }
  | { readonly kind: 'no-webgl'; readonly reason: string };

const MAX_PIXEL_RATIO = 2;
const CAMERA_FOV_DEG = 40;
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
  const markers = createMarkers(three, scene);
  const { marker, liveMarker } = markers;

  return {
    setSegments: (segments) => {
      disposeChildren(toolpathGroup);
      const built = buildToolpathObjects({
        ...modules,
        segments,
        theme,
        viewWidth,
        viewHeight,
        travelVisible,
      });
      ({ fatMaterial, travelObject } = built);
      reveal = built.reveal;
      for (const object of built.objects) toolpathGroup.add(object);
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
    resize: (nextWidth, nextHeight) => {
      if (nextWidth <= 0 || nextHeight <= 0) return;
      viewWidth = nextWidth;
      viewHeight = nextHeight;
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      fatMaterial?.resolution.set(nextWidth, nextHeight);
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

// WebGL context creation is the one failure mode this module tolerates: jsdom
// and WebGL-less browsers get a typed fallback instead of a throw.
function startRenderer(
  three: ThreeModule,
  canvas: HTMLCanvasElement,
  theme: Viewer3dTheme,
):
  | {
      readonly kind: 'ok';
      readonly renderer: WebGLRenderer;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'no-webgl'; readonly reason: string } {
  let renderer: WebGLRenderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    return {
      kind: 'no-webgl',
      reason: err instanceof Error ? err.message : 'WebGL is unavailable in this browser.',
    };
  }
  // HiDPI-correct output — the single most visible quality defect of the
  // pre-ADR-255 scene was rendering at CSS-pixel resolution.
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, MAX_PIXEL_RATIO));
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  renderer.setSize(width, height, false);
  renderer.setClearColor(theme.background);
  return { kind: 'ok', renderer, width, height };
}

type OrbitControlsCtor = typeof OrbitControlsModule.OrbitControls;

type CameraRig = {
  readonly camera: PerspectiveCamera;
  readonly controls: InstanceType<OrbitControlsCtor>;
  readonly render: () => void;
};

// Z-up perspective camera + orbit controls, wired to render on demand (no rAF
// loop — the scene only redraws on interaction, resize, or data change).
function createCameraRig(
  three: ThreeModule,
  OrbitControls: OrbitControlsCtor,
  deps: {
    readonly renderer: WebGLRenderer;
    readonly scene: ThreeNamespace.Scene;
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
  },
): CameraRig {
  const camera = new three.PerspectiveCamera(
    CAMERA_FOV_DEG,
    deps.width / deps.height,
    0.1,
    100_000,
  );
  camera.up.set(0, 0, 1); // Z-up: the program's own frame
  const controls = new OrbitControls(camera, deps.canvas);
  const render = (): void => deps.renderer.render(deps.scene, camera);
  controls.addEventListener('change', render);
  return { camera, controls, render };
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
