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
import { buildSegmentBuckets, type Viewer3dSegmentsInput } from './segment-buckets';
import { resolveViewer3dTheme, type Viewer3dTheme } from './viewer3d-theme';

export type Viewer3dSegments = Viewer3dSegmentsInput;

export type Viewer3dSceneHandle = {
  readonly setSegments: (segments: Viewer3dSegments) => void;
  readonly fitToBounds: (bounds: AxisBounds | null) => void;
  /** LightBurn's "show traversal moves" toggle. */
  readonly setTravelVisible: (visible: boolean) => void;
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
const FIT_DISTANCE_FACTOR = 1.7;
const DEFAULT_VIEW_MM = 100;
const GRID_STEP_MM = 10;

type ThreeModule = typeof ThreeNamespace;

// Every three module the scene needs, loaded in one lazy chunk (ADR-102 §3).
async function loadThree(): Promise<{
  readonly three: ThreeModule;
  readonly OrbitControls: OrbitControlsCtor;
  readonly LineSegments2: typeof LineSegments2Module.LineSegments2;
  readonly LineSegmentsGeometry: typeof LineSegmentsGeometryModule.LineSegmentsGeometry;
  readonly LineMaterial: typeof LineMaterialModule.LineMaterial;
}> {
  const three = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const { LineSegments2 } = await import('three/examples/jsm/lines/LineSegments2.js');
  const { LineSegmentsGeometry } = await import('three/examples/jsm/lines/LineSegmentsGeometry.js');
  const { LineMaterial } = await import('three/examples/jsm/lines/LineMaterial.js');
  return { three, OrbitControls, LineSegments2, LineSegmentsGeometry, LineMaterial };
}

export async function createViewer3dScene(canvas: HTMLCanvasElement): Promise<Viewer3dSceneResult> {
  const { three, OrbitControls, LineSegments2, LineSegmentsGeometry, LineMaterial } =
    await loadThree();
  const theme = resolveViewer3dTheme(canvas);

  const started = startRenderer(three, canvas, theme);
  if (started.kind === 'no-webgl') return started;
  const { renderer, width, height } = started;

  const scene = new three.Scene();
  const toolpathGroup = new three.Group();
  const furnitureGroup = new three.Group();
  scene.add(toolpathGroup);
  scene.add(furnitureGroup);

  const { camera, controls, render } = createCameraRig(three, OrbitControls, {
    renderer,
    scene,
    canvas,
    width,
    height,
  });

  // Fat-line materials size their strokes against the drawing buffer, so the
  // current view size is tracked and pushed into the material on resize.
  let viewWidth = width;
  let viewHeight = height;
  let fatMaterial: LineMaterialType | null = null;
  let travelObject: Object3D | null = null;
  let travelVisible = true;

  const handle: Viewer3dSceneHandle = {
    setSegments: (segments) => {
      disposeChildren(toolpathGroup);
      const built = buildToolpathObjects({
        three,
        LineSegments2,
        LineSegmentsGeometry,
        LineMaterial,
        segments,
        theme,
        viewWidth,
        viewHeight,
        travelVisible,
      });
      fatMaterial = built.fatMaterial;
      travelObject = built.travelObject;
      for (const object of built.objects) toolpathGroup.add(object);
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
      renderer.dispose();
    },
  };
  handle.fitToBounds(null);
  return { kind: 'ok', handle };
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
} {
  const buckets = buildSegmentBuckets(args.segments, args.theme);
  const objects: Object3D[] = [];
  let fatMaterial: LineMaterialType | null = null;
  let travelObject: Object3D | null = null;
  if (buckets.solid.count > 0) {
    const geometry = new args.LineSegmentsGeometry();
    geometry.setPositions(buckets.solid.positions);
    geometry.setColors(buckets.solid.colors);
    fatMaterial = new args.LineMaterial({ vertexColors: true, linewidth: FAT_LINE_PX });
    fatMaterial.resolution.set(args.viewWidth, args.viewHeight);
    const lines = new args.LineSegments2(geometry, fatMaterial);
    lines.renderOrder = 1;
    objects.push(lines);
  }
  if (buckets.travel.count > 0) {
    travelObject = lineSegmentsObject(
      args.three,
      buckets.travel.positions,
      args.theme.travel,
      TRAVEL_OPACITY,
      0,
    );
    travelObject.visible = args.travelVisible;
    objects.push(travelObject);
  }
  return { objects, fatMaterial, travelObject };
}

function lineSegmentsObject(
  three: ThreeModule,
  positions: Float32Array,
  color: number,
  opacity: number,
  renderOrder: number,
): Object3D {
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

function buildFurniture(
  three: ThreeModule,
  bounds: AxisBounds | null,
  theme: Viewer3dTheme,
): ReadonlyArray<Object3D> {
  const extent = boundsExtent(bounds);
  const gridSize = Math.ceil((extent * FIT_DISTANCE_FACTOR) / GRID_STEP_MM) * GRID_STEP_MM * 2;
  const divisions = Math.max(2, Math.round(gridSize / GRID_STEP_MM));
  const grid = new three.GridHelper(gridSize, divisions, theme.gridMajor, theme.gridMinor);
  // GridHelper lies in XZ; rotate onto the XY work plane (Z-up frame).
  grid.rotation.x = Math.PI / 2;
  const center = boundsCenter(bounds);
  grid.position.set(center.x, center.y, 0);
  const axes = new three.AxesHelper(Math.max(GRID_STEP_MM, extent * 0.25));
  return [grid, axes];
}

function frameCamera(
  camera: PerspectiveCamera,
  controls: { target: { set: (x: number, y: number, z: number) => void }; update: () => void },
  bounds: AxisBounds | null,
): void {
  const center = boundsCenter(bounds);
  const distance = boundsExtent(bounds) * FIT_DISTANCE_FACTOR;
  camera.position.set(center.x + distance * 0.6, center.y - distance * 0.6, distance * 0.55);
  controls.target.set(center.x, center.y, center.z);
  camera.lookAt(center.x, center.y, center.z);
  controls.update();
}

function boundsCenter(bounds: AxisBounds | null): { x: number; y: number; z: number } {
  if (bounds === null) return { x: 0, y: 0, z: 0 };
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

function boundsExtent(bounds: AxisBounds | null): number {
  if (bounds === null) return DEFAULT_VIEW_MM;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ - bounds.minZ;
  return Math.max(spanX, spanY, spanZ, GRID_STEP_MM);
}

// Complete disposal: geometry AND material of every child (the pre-ADR-255
// scene leaked materials on every rebuild — [R3D] gap 4).
function disposeChildren(group: Object3D): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const mesh = child as { geometry?: { dispose?: () => void }; material?: unknown };
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    for (const entry of Array.isArray(material) ? material : [material]) {
      (entry as { dispose?: () => void } | undefined)?.dispose?.();
    }
  }
}
