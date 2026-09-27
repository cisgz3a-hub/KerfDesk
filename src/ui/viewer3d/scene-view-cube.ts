// View cube (ADR-426): a labelled cube in the viewport corner that turns with
// the camera. Clicking a face turns the view to face it.
//
// It draws into a scissored corner of the main renderer rather than a second
// canvas, so it costs no extra WebGL context. Pointer events reach it through
// a DOM hit area the viewport places over the same corner (VIEW_CUBE_LAYOUT),
// which also keeps the orbit controls from starting a drag there.

import type * as ThreeNamespace from 'three';
import type { Camera, Mesh, MeshBasicMaterial, WebGLRenderer } from 'three';
import type { Viewer3dView } from './camera-presets';

type ThreeModule = typeof ThreeNamespace;

/** Where the cube sits, in CSS pixels from the viewport's bottom-right corner. */
export const VIEW_CUBE_LAYOUT = { sizePx: 84, rightPx: 12, bottomPx: 52 } as const;

type Face = {
  readonly view: Exclude<Viewer3dView, 'iso'>;
  readonly label: string;
  readonly normal: readonly [number, number, number];
  readonly up: readonly [number, number, number];
};

const FACES: ReadonlyArray<Face> = [
  { view: 'top', label: 'TOP', normal: [0, 0, 1], up: [0, 1, 0] },
  { view: 'bottom', label: 'BOTTOM', normal: [0, 0, -1], up: [0, -1, 0] },
  { view: 'front', label: 'FRONT', normal: [0, -1, 0], up: [0, 0, 1] },
  { view: 'back', label: 'BACK', normal: [0, 1, 0], up: [0, 0, 1] },
  { view: 'right', label: 'RIGHT', normal: [1, 0, 0], up: [0, 0, 1] },
  { view: 'left', label: 'LEFT', normal: [-1, 0, 0], up: [0, 0, 1] },
];

const FACE_TINT = 0xffffff;
const HOVER_TINT = 0xffc49a;
const CUBE_CAMERA_DISTANCE = 6;
const CUBE_HALF_VIEW = 1.9;
const FACE_TEXTURE_PX = 128;

export type ViewCube = {
  /** Draws the cube into its corner after the main frame. */
  readonly render: (
    renderer: WebGLRenderer,
    camera: Camera,
    target: ThreeNamespace.Vector3,
  ) => void;
  /** The face under a point given as fractions of the cube's square (0,0 top-left). */
  readonly pick: (xFraction: number, yFraction: number) => Viewer3dView | null;
  /** Highlights a face; returns whether anything changed. */
  readonly hover: (view: Viewer3dView | null) => boolean;
  readonly dispose: () => void;
};

export function createViewCube(three: ThreeModule): ViewCube {
  const scene = new three.Scene();
  const camera = new three.OrthographicCamera(
    -CUBE_HALF_VIEW,
    CUBE_HALF_VIEW,
    CUBE_HALF_VIEW,
    -CUBE_HALF_VIEW,
    0.1,
    20,
  );
  camera.up.set(0, 0, 1);
  const faces = FACES.map((face) => faceMesh(three, face));
  for (const mesh of faces) scene.add(mesh);
  const edges = new three.LineSegments(
    new three.EdgesGeometry(new three.BoxGeometry(2.01, 2.01, 2.01)),
    new three.LineBasicMaterial({ color: 0x8b929c, toneMapped: false }),
  );
  scene.add(edges);
  const raycaster = new three.Raycaster();
  const pointer = new three.Vector2();
  const direction = new three.Vector3();
  let hovered: Viewer3dView | null = null;
  return {
    render: (renderer, mainCamera, target) => {
      direction.copy(mainCamera.position).sub(target).normalize();
      camera.position.copy(direction).multiplyScalar(CUBE_CAMERA_DISTANCE);
      camera.lookAt(0, 0, 0);
      drawInCorner(three, renderer, scene, camera);
    },
    pick: (xFraction, yFraction) => {
      pointer.set(xFraction * 2 - 1, 1 - yFraction * 2);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(faces, false)[0];
      return (hit?.object.userData['view'] as Viewer3dView | undefined) ?? null;
    },
    hover: (view) => {
      if (view === hovered) return false;
      hovered = view;
      for (const mesh of faces) {
        mesh.material.color.setHex(mesh.userData['view'] === view ? HOVER_TINT : FACE_TINT);
      }
      return true;
    },
    dispose: () => {
      for (const mesh of faces) {
        mesh.geometry.dispose();
        mesh.material.map?.dispose();
        mesh.material.dispose();
      }
      edges.geometry.dispose();
      edges.material.dispose();
    },
  };
}

// Scissor to the corner, keep the main image (no colour clear), clear depth
// so the cube is never hidden by the job, then restore the full viewport.
function drawInCorner(
  three: ThreeModule,
  renderer: WebGLRenderer,
  scene: ThreeNamespace.Scene,
  camera: Camera,
): void {
  const size = renderer.getSize(new three.Vector2());
  const { sizePx, rightPx, bottomPx } = VIEW_CUBE_LAYOUT;
  const x = size.x - rightPx - sizePx;
  if (x < 0 || size.y < bottomPx + sizePx) return;
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setScissor(x, bottomPx, sizePx, sizePx);
  renderer.setViewport(x, bottomPx, sizePx, sizePx);
  renderer.clearDepth();
  renderer.render(scene, camera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size.x, size.y);
  renderer.autoClear = autoClear;
}

function faceMesh(
  three: ThreeModule,
  face: Face,
): Mesh<ThreeNamespace.PlaneGeometry, MeshBasicMaterial> {
  const material = new three.MeshBasicMaterial({
    map: faceTexture(three, face.label),
    toneMapped: false,
  });
  const mesh = new three.Mesh(new three.PlaneGeometry(2, 2), material);
  const normal = new three.Vector3(...face.normal);
  const up = new three.Vector3(...face.up);
  const right = up.clone().cross(normal);
  mesh.quaternion.setFromRotationMatrix(new three.Matrix4().makeBasis(right, up, normal));
  mesh.position.copy(normal);
  mesh.userData['view'] = face.view;
  return mesh;
}

function faceTexture(three: ThreeModule, label: string): ThreeNamespace.Texture | null {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_TEXTURE_PX;
  canvas.height = FACE_TEXTURE_PX;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const size = FACE_TEXTURE_PX;
  const gradient = context.createLinearGradient(0, 0, 0, size);
  /* eslint-disable no-restricted-syntax -- the cube is part of the 3D scene,
     drawn over the dark viewport in every app theme; not UI chrome. */
  gradient.addColorStop(0, '#454b55');
  gradient.addColorStop(1, '#353a42');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  context.lineWidth = size / 32;
  context.strokeRect(size / 64, size / 64, size - size / 32, size - size / 32);
  context.fillStyle = '#ece8e1';
  /* eslint-enable no-restricted-syntax */
  context.font = `600 ${label.length > 5 ? size / 5.2 : size / 4.4}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, size / 2, size / 2 + size / 40);
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
