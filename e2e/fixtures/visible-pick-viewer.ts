import * as three from 'three';
import { buildGcodeRenderModel } from '../../src/core/gcode-view';
import { measuredPoint } from '../../src/ui/gcode-inspector/use-measure';
import { disposeChildren } from '../../src/ui/viewer3d/scene-furniture';
import {
  clipObjects,
  toThreePlanes,
  type Viewer3dClipPlane,
} from '../../src/ui/viewer3d/scene-isolate';
import type { Point3 } from '../../src/ui/viewer3d/scene-parts';
import { createToolpathPicker, type PickPointer } from '../../src/ui/viewer3d/scene-pick';
import { applyRecolor, buildToolpathObjects } from '../../src/ui/viewer3d/scene-toolpath';
import { applyTravelLook } from '../../src/ui/viewer3d/scene-travel-look';
import { srgbToLinear, type Viewer3dLook } from '../../src/ui/viewer3d/viewer3d-look';
import { loadThree } from '../../src/ui/viewer3d/viewer3d-modules';
import { resolveViewer3dTheme } from '../../src/ui/viewer3d/viewer3d-theme';

export interface VisiblePickOptions {
  text: string;
  sample: Point3;
  look: Viewer3dLook;
  perspective: boolean;
  travel: boolean;
  angle?: 'top' | 'iso' | 'grazing';
  alignToPixelCentre?: boolean;
  pixelRatio?: 1 | 2;
  planes?: readonly Viewer3dClipPlane[];
  hiddenSegments?: readonly number[];
  /** Fixed CSS pixel index for the separate coplanar pointer control. */
  pointerPixel?: readonly [number, number];
  /** Change only the camera range after the original framing/alignment. */
  clipRange?: readonly [number, number];
}

/** Read pixels and pick IDs from the actual production toolpath and picker. */
export async function visiblePickFrame(options: VisiblePickOptions) {
  const modules = await loadThree();
  const parsed = buildGcodeRenderModel(options.text, { machineKind: 'laser' });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const visible =
    options.hiddenSegments === undefined
      ? undefined
      : Uint8Array.from({ length: parsed.model.segmentCount }, (_, index) =>
          options.hiddenSegments?.includes(index) ? 0 : 1,
        );
  const renderer = new three.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(options.pixelRatio ?? 1);
  renderer.setSize(800, 600);
  renderer.localClippingEnabled = true;
  const theme = resolveViewer3dTheme();
  renderer.setClearColor(theme.background);
  const scene = new three.Scene();
  const group = new three.Group();
  scene.add(group);
  const build = buildToolpathObjects({
    ...modules,
    segments: visible === undefined ? parsed.model : { ...parsed.model, visible },
    theme,
    viewWidth: 800,
    viewHeight: 600,
    travelVisible: options.travel,
  });
  group.add(...build.objects);
  applyTravelLook(three, build.travelLine, options.look, theme, 100);
  if (options.look === 'studio')
    applyRecolor(build.reveal, () => [79 / 255, 163 / 255, 1], srgbToLinear);
  const camera = frameCamera(options);
  const picker = createToolpathPicker(modules, { renderer, scene, width: 800, height: 600 });
  picker.setTargets(build.reveal);
  const planes = toThreePlanes(three, options.planes ?? []);
  clipObjects(group, planes);
  picker.setClipPlanes(planes);
  const projected = new three.Vector3(options.sample.x, options.sample.y, options.sample.z).project(
    camera,
  );
  const pointer = {
    xPx: options.pointerPixel?.[0] ?? (projected.x + 1) * 400,
    yPx: options.pointerPixel?.[1] ?? (1 - projected.y) * 300,
    widthPx: 800,
    heightPx: 600,
  };
  try {
    renderer.render(scene, camera);
    const pixel = readPixel(renderer, pointer, options.alignToPixelCentre === true);
    const data = renderer.domElement.toDataURL('image/png');
    const pick = picker.pick(camera, pointer);
    return {
      data,
      pixel,
      pointer,
      pick,
      planar: build.reveal.planarDensity !== null,
      drawingBuffer: { width: renderer.domElement.width, height: renderer.domElement.height },
      measuredPoint: pick === null ? null : measuredPoint(pick),
    };
  } finally {
    picker.dispose();
    disposeChildren(scene);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

function frameCamera(options: VisiblePickOptions) {
  const camera = options.perspective
    ? new three.PerspectiveCamera(40, 4 / 3, 0.1, 1000)
    : new three.OrthographicCamera(-60, 60, 45, -45, 0.1, 1000);
  const angle = options.angle ?? 'top';
  if (angle === 'top') camera.position.set(50, 0, 130);
  else if (angle === 'iso') camera.position.set(150, -100, 100);
  else camera.position.set(100, -100, 25);
  camera.up.set(0, angle === 'top' ? 1 : 0, angle === 'top' ? 0 : 1);
  camera.lookAt(50, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  if (options.alignToPixelCentre)
    centreCameraOnPixel(camera, options.sample, options.pixelRatio ?? 1);
  if (options.clipRange !== undefined) {
    [camera.near, camera.far] = options.clipRange;
    camera.updateProjectionMatrix();
  }
  return camera;
}

// Translate the camera and target together in its image plane. The physical
// overlap then lands on a pixel centre instead of an MSAA edge, without
// changing the scene geometry, stroke width, colours or depth policy.
function centreCameraOnPixel(
  camera: three.PerspectiveCamera | three.OrthographicCamera,
  sample: Point3,
  pixelRatio: number,
): void {
  const point = new three.Vector3(sample.x, sample.y, sample.z);
  const projected = point.clone().project(camera);
  const x = (projected.x + 1) * 400;
  const y = (1 - projected.y) * 300;
  const mmPerPixel =
    'isPerspectiveCamera' in camera
      ? (-point.clone().applyMatrix4(camera.matrixWorldInverse).z *
          2 *
          Math.tan(three.MathUtils.degToRad(camera.fov / 2))) /
        (600 * camera.zoom)
      : (camera.top - camera.bottom) / (600 * camera.zoom);
  const shift = new three.Vector3()
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .multiplyScalar(-((Math.round(x * pixelRatio) + 0.5) / pixelRatio - x) * mmPerPixel)
    .addScaledVector(
      new three.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
      ((Math.round(y * pixelRatio) + 0.5) / pixelRatio - y) * mmPerPixel,
    );
  camera.position.add(shift);
  camera.lookAt(new three.Vector3(50, 0, 0).add(shift));
  camera.updateMatrixWorld();
}

function readPixel(
  renderer: three.WebGLRenderer,
  pointer: PickPointer,
  centred: boolean,
): number[] {
  const coordinate = centred ? Math.floor : Math.round;
  const pixelRatio = renderer.getPixelRatio();
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  gl.readPixels(
    coordinate(pointer.xPx * pixelRatio),
    renderer.domElement.height - 1 - coordinate(pointer.yPx * pixelRatio),
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixel,
  );
  return [...pixel];
}
