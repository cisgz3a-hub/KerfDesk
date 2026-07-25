// createReliefThreeScene — the ONLY module that touches three.js (ADR-102
// §2: three is UI-only, lazy-loaded). Builds a Z-up scene from the pure
// core mesh arrays: carved surface + stock outline, orbit controls, and
// render-on-demand (no rAF loop — renders on interaction/resize only).

// Type-only import: erased at compile time, so three itself still loads
// lazily through the dynamic import() below (ADR-102 §3).
import type * as ThreeNamespace from 'three';
import type { BufferGeometry, Object3D, Scene, WebGLRenderer } from 'three';
import type { ReliefSurfaceMesh } from '../../core/relief';
import type { ToolProfilePoint } from '../../core/sim';
import { firstCuttingPoint, type Move3d } from '../../core/toolpath3d';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import { buildStageFurniture, buildToolMesh, buildToolpathLines } from '../viewer3d';
import { applySceneLighting } from './scene-lighting';

// The toolpath to overlay, in the SAME scene frame the removal grid was
// stamped from, plus that grid's scene-space min corner.
type ThreeModule = typeof ThreeNamespace;

export type ViewerToolpathOverlay = {
  readonly moves: ReadonlyArray<Move3d>;
  readonly originMm: { readonly x: number; readonly y: number };
  // Omitted for jobs with no CNC tool; the path still draws without a cutter.
  readonly toolProfile?: ReadonlyArray<ToolProfilePoint>;
};

export type ReliefSceneHandle = {
  readonly dispose: () => void;
  // Re-fit the renderer + camera to a new canvas size. The scene renders on
  // demand (no rAF loop), so a resizable host must call this when its box
  // changes or the buffer stays at its mount-time size and scales blurrily.
  readonly resize: (width: number, height: number) => void;
};

export type ReliefSceneResult =
  | { readonly kind: 'ok'; readonly handle: ReliefSceneHandle }
  | { readonly kind: 'no-webgl'; readonly reason: string };

// Either surface builder's output. The smooth relief mesh omits `normals` and
// lets three average them, which is right for an organic carve; the stepped CNC
// mesh authors them so pocket walls stay vertical (ADR-254).
export type ViewerSurfaceMesh = ReliefSurfaceMesh & {
  readonly normals?: Float32Array;
};

const CAMERA_FOV_DEG = 40;

// Builds the carved-surface geometry in the viewport's shared frame.
function buildSurfaceGeometry(three: ThreeModule, mesh: ViewerSurfaceMesh): BufferGeometry {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.BufferAttribute(mesh.positions.slice(), 3));
  geometry.setIndex(new three.BufferAttribute(mesh.indices.slice(), 1));
  // Authored normals are attached BEFORE the mirror so three's applyMatrix4
  // carries them through its normal matrix. Attaching them afterwards would
  // leave every wall lit as though it faced the other way.
  if (mesh.normals !== undefined) {
    geometry.setAttribute('normal', new three.BufferAttribute(mesh.normals.slice(), 3));
  }
  // The heightmap's row axis points down the canvas; mirror it so text
  // reliefs read the right way round, then recenter on the origin.
  geometry.scale(1, -1, 1);
  geometry.translate(-mesh.widthMm / 2, mesh.heightMm / 2, 0);
  // Only the smooth builder needs averaged normals. Running this over an
  // authored mesh would average the vertical walls back into 45° ramps.
  if (mesh.normals === undefined) {
    geometry.computeVertexNormals();
  }
  return geometry;
}

// Stock outline: a wire box from the stock top (z=0) down one thickness.
// BoxGeometry is only the source shape — EdgesGeometry is what the
// LineSegments actually holds, so both need disposing.
function addStockOutline(
  three: ThreeModule,
  scene: Scene,
  mesh: ViewerSurfaceMesh,
  stockThicknessMm: number,
): { readonly dispose: () => void } {
  const stockGeometry = new three.BoxGeometry(mesh.widthMm, mesh.heightMm, stockThicknessMm);
  const edgeGeometry = new three.EdgesGeometry(stockGeometry);
  const edgeMaterial = new three.LineBasicMaterial({ color: viewer3dTheme.color.stockEdge });
  const edges = new three.LineSegments(edgeGeometry, edgeMaterial);
  edges.position.set(0, 0, -stockThicknessMm / 2);
  scene.add(edges);
  return {
    dispose: () => {
      stockGeometry.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
    },
  };
}

// Parks the cutter at the program's first cutting point. Until playback
// exists this is the one static position that says something true: where the
// job starts and which bit will do it. The point arrives in the same scene
// frame as the path, so it takes the same origin shift and mirror.
function buildParkedTool(
  three: ThreeModule,
  mesh: ViewerSurfaceMesh,
  toolpath: ViewerToolpathOverlay | undefined,
): { readonly object: Object3D; readonly dispose: () => void } | null {
  if (toolpath?.toolProfile === undefined) return null;
  const start = firstCuttingPoint(toolpath.moves);
  if (start === null) return null;
  return buildToolMesh(three, toolpath.toolProfile, {
    x: start.x - toolpath.originMm.x - mesh.widthMm / 2,
    // Mirrored to match the surface, then recentred — the same composition the
    // surface geometry is baked with, done arithmetically because a single
    // point needs no transform node.
    y: -(start.y - toolpath.originMm.y) + mesh.heightMm / 2,
    z: start.z,
  });
}

export async function createReliefThreeScene(
  canvas: HTMLCanvasElement,
  mesh: ViewerSurfaceMesh,
  stockThicknessMm: number,
  toolpath?: ViewerToolpathOverlay,
): Promise<ReliefSceneResult> {
  const three = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');

  let renderer: WebGLRenderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    return {
      kind: 'no-webgl',
      reason: err instanceof Error ? err.message : 'WebGL is unavailable in this browser.',
    };
  }
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  renderer.setSize(width, height, false);
  renderer.setClearColor(viewer3dTheme.color.background);

  const scene = new three.Scene();
  const geometry = buildSurfaceGeometry(three, mesh);
  const surfaceMaterial = new three.MeshStandardMaterial({
    color: viewer3dTheme.color.surface,
    side: three.DoubleSide,
    flatShading: false,
  });
  scene.add(new three.Mesh(geometry, surfaceMaterial));

  const stock = addStockOutline(three, scene, mesh, stockThicknessMm);
  const stage = buildStageFurniture(three, mesh, stockThicknessMm);
  scene.add(stage.object);

  // The toolpath rides the SAME mirror and recentre the surface geometry got
  // baked with, applied here as an object transform. Object matrices compose
  // as T * R * S, so setting position and scale reproduces geometry.scale()
  // followed by geometry.translate() exactly. Sharing one transform is what
  // keeps the path registered to the cut it describes (ADR-254 §2).
  const toolpathLines =
    toolpath === undefined
      ? null
      : await buildToolpathLines(three, toolpath.moves, toolpath.originMm);
  if (toolpathLines !== null) {
    toolpathLines.object.scale.set(1, -1, 1);
    toolpathLines.object.position.set(-mesh.widthMm / 2, mesh.heightMm / 2, 0);
    scene.add(toolpathLines.object);
  }

  const tool = buildParkedTool(three, mesh, toolpath);
  if (tool !== null) scene.add(tool.object);

  const lighting = applySceneLighting(three, renderer, scene, mesh);

  const camera = new three.PerspectiveCamera(CAMERA_FOV_DEG, width / height, 0.1, 10_000);
  camera.up.set(0, 0, 1); // Z-up: depth reads vertically
  const orbitRadius = Math.max(mesh.widthMm, mesh.heightMm, stockThicknessMm * 4) * 1.6;
  camera.position.set(orbitRadius * 0.7, -orbitRadius * 0.7, orbitRadius * 0.6);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, canvas);
  const render = (): void => renderer.render(scene, camera);
  controls.addEventListener('change', render);
  render();

  return {
    kind: 'ok',
    handle: {
      resize: (width, height) => {
        if (width <= 0 || height <= 0) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        render();
      },
      dispose: () => {
        controls.removeEventListener('change', render);
        controls.dispose();
        lighting.dispose();
        toolpathLines?.dispose();
        tool?.dispose();
        stage.dispose();
        geometry.dispose();
        surfaceMaterial.dispose();
        stock.dispose();
        renderer.dispose();
      },
    },
  };
}
