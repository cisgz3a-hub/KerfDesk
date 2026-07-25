// createReliefThreeScene — the ONLY module that touches three.js (ADR-102
// §2: three is UI-only, lazy-loaded). Builds a Z-up scene from the pure
// core mesh arrays: carved surface + stock outline, orbit controls, and
// render-on-demand (no rAF loop — renders on interaction/resize only).

// Type-only import: erased at compile time, so three itself still loads
// lazily through the dynamic import() below (ADR-102 §3).
import type { WebGLRenderer } from 'three';
import type { ReliefSurfaceMesh } from '../../core/relief';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import { applySceneLighting } from './scene-lighting';

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

const CAMERA_FOV_DEG = 40;

export async function createReliefThreeScene(
  canvas: HTMLCanvasElement,
  mesh: ReliefSurfaceMesh,
  stockThicknessMm: number,
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
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.BufferAttribute(mesh.positions.slice(), 3));
  geometry.setIndex(new three.BufferAttribute(mesh.indices.slice(), 1));
  // The heightmap's row axis points down the canvas; mirror it so text
  // reliefs read the right way round, then recenter on the origin.
  geometry.scale(1, -1, 1);
  geometry.translate(-mesh.widthMm / 2, mesh.heightMm / 2, 0);
  geometry.computeVertexNormals();
  const surfaceMaterial = new three.MeshStandardMaterial({
    color: viewer3dTheme.color.surface,
    side: three.DoubleSide,
    flatShading: false,
  });
  scene.add(new three.Mesh(geometry, surfaceMaterial));

  // Stock outline: a wire box from the stock top (z=0) down one thickness.
  // BoxGeometry is only the source shape — EdgesGeometry is what the
  // LineSegments actually holds, so both need disposing.
  const stockGeometry = new three.BoxGeometry(mesh.widthMm, mesh.heightMm, stockThicknessMm);
  const stockEdgeGeometry = new three.EdgesGeometry(stockGeometry);
  const stockEdgeMaterial = new three.LineBasicMaterial({
    color: viewer3dTheme.color.stockEdge,
  });
  const stockEdges = new three.LineSegments(stockEdgeGeometry, stockEdgeMaterial);
  stockEdges.position.set(0, 0, -stockThicknessMm / 2);
  scene.add(stockEdges);

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
        geometry.dispose();
        surfaceMaterial.dispose();
        stockGeometry.dispose();
        stockEdgeGeometry.dispose();
        stockEdgeMaterial.dispose();
        renderer.dispose();
      },
    },
  };
}
