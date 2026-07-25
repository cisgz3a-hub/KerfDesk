// createViewer3dScene — the shared three.js scene shell (ADR-255 stage 3;
// ADR-102 §2 as amended: src/ui/viewer3d/ is a sanctioned three home).
// Z-up work-coordinate frame, DPR-correct rendering, orbit controls,
// bed/grid/origin furniture, render-on-demand, and complete disposal.

// Type-only imports: erased at compile time, so three itself still loads
// lazily through the dynamic import() below (ADR-102 §3).
import type * as ThreeNamespace from 'three';
import type { Object3D, PerspectiveCamera, WebGLRenderer } from 'three';
import { SEG_KIND, type AxisBounds } from '../../core/gcode-view';
import { resolveViewer3dTheme, type Viewer3dTheme } from './viewer3d-theme';

export type Viewer3dSegments = {
  readonly segmentCount: number;
  /** Six floats per segment: x0 y0 z0 x1 y1 z1 (work coordinates, mm). */
  readonly positions: Float32Array;
  readonly segKind: Uint8Array;
};

export type Viewer3dSceneHandle = {
  readonly setSegments: (segments: Viewer3dSegments) => void;
  readonly fitToBounds: (bounds: AxisBounds | null) => void;
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
const FIT_DISTANCE_FACTOR = 1.7;
const DEFAULT_VIEW_MM = 100;
const GRID_STEP_MM = 10;

type ThreeModule = typeof ThreeNamespace;

export async function createViewer3dScene(canvas: HTMLCanvasElement): Promise<Viewer3dSceneResult> {
  const three = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const theme = resolveViewer3dTheme(canvas);

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

  const scene = new three.Scene();
  const toolpathGroup = new three.Group();
  const furnitureGroup = new three.Group();
  scene.add(toolpathGroup);
  scene.add(furnitureGroup);

  const camera = new three.PerspectiveCamera(CAMERA_FOV_DEG, width / height, 0.1, 100_000);
  camera.up.set(0, 0, 1); // Z-up: the program's own frame
  const controls = new OrbitControls(camera, canvas);
  const render = (): void => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  const handle: Viewer3dSceneHandle = {
    setSegments: (segments) => {
      disposeChildren(toolpathGroup);
      for (const object of buildSegmentObjects(three, segments, theme)) {
        toolpathGroup.add(object);
      }
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
    resize: (nextWidth, nextHeight) => {
      if (nextWidth <= 0 || nextHeight <= 0) return;
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
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

// Two batched polyline objects for stage 3: recessive traversal (LightBurn's
// red-means-rapid, thin + translucent) and everything else. Per-kind palette
// and fat cut lines arrive in stage 4.
function buildSegmentObjects(
  three: ThreeModule,
  segments: Viewer3dSegments,
  theme: Viewer3dTheme,
): ReadonlyArray<Object3D> {
  let travelCount = 0;
  for (let index = 0; index < segments.segmentCount; index += 1) {
    if (segments.segKind[index] === SEG_KIND.travel) travelCount += 1;
  }
  const cutCount = segments.segmentCount - travelCount;
  const travelPositions = new Float32Array(travelCount * 6);
  const cutPositions = new Float32Array(cutCount * 6);
  let travelAt = 0;
  let cutAt = 0;
  for (let index = 0; index < segments.segmentCount; index += 1) {
    const isTravel = segments.segKind[index] === SEG_KIND.travel;
    const target = isTravel ? travelPositions : cutPositions;
    const offset = isTravel ? travelAt : cutAt;
    for (let component = 0; component < 6; component += 1) {
      target[offset + component] = segments.positions[index * 6 + component] ?? 0;
    }
    if (isTravel) travelAt += 6;
    else cutAt += 6;
  }
  const objects: Object3D[] = [];
  if (cutCount > 0) {
    objects.push(lineSegmentsObject(three, cutPositions, theme.cut, 1, 1));
  }
  if (travelCount > 0) {
    objects.push(lineSegmentsObject(three, travelPositions, theme.travel, TRAVEL_OPACITY, 0));
  }
  return objects;
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
