import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { buildGcodeRenderModel } from '../../src/core/gcode-view';
import { disposeChildren } from '../../src/ui/viewer3d/scene-furniture';
import {
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  writeDepthPlane,
} from '../../src/ui/viewer3d/line-depth-plane-geometry';
import {
  applyRecolor,
  applyReveal,
  buildToolpathObjects,
} from '../../src/ui/viewer3d/scene-toolpath';
import { applyTravelLook } from '../../src/ui/viewer3d/scene-travel-look';
import { srgbToLinear } from '../../src/ui/viewer3d/viewer3d-look';
import { resolveViewer3dTheme } from '../../src/ui/viewer3d/viewer3d-theme';

interface Options {
  look: 'classic' | 'studio';
  pixelRatio: number;
  antialias: boolean;
  perspective: boolean;
  physicalActive: boolean;
  prefixFraction?: number;
}

const INPUT = 'G21 G90\nM3 S500\nG1 X100 Z1 F600\nM5\nG0 Z1\nG0 X0 Z0\nG0 Y10';

export function nativeActiveBodyFrame(options: Options) {
  const parsed = buildGcodeRenderModel(INPUT, {
    machineKind: 'laser',
    retainPreciseSegmentLengths: true,
  });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const renderer = new three.WebGLRenderer({
    antialias: options.antialias,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(options.pixelRatio);
  renderer.setSize(800, 600, false);
  const gl = renderer.getContext();
  const theme = resolveViewer3dTheme();
  renderer.setClearColor(theme.background);
  const scene = new three.Scene();
  const built = buildToolpathObjects({
    three,
    LineMaterial,
    LineSegments2,
    LineSegmentsGeometry,
    segments: parsed.model,
    theme,
    viewWidth: 800,
    viewHeight: 600,
    travelVisible: true,
  });
  scene.add(...built.objects);
  if (built.travelObject) built.travelObject.visible = true;
  applyTravelLook(three, built.travelLine, options.look, theme, 100);
  applyRecolor(
    built.reveal,
    () => [79 / 255, 163 / 255, 1],
    options.look === 'studio' ? srgbToLinear : undefined,
  );
  const prefixFraction = options.prefixFraction ?? 0.5;
  applyReveal(built.reveal, {
    segmentIndex: 0,
    point: { x: 100 * prefixFraction, y: 0, z: prefixFraction },
  });
  // Replay the retained comparison hook as a compatibility control. The retired
  // split has one physical writer; analytical white is the semantic oracle.
  if (options.physicalActive) built.reveal.active.useHardwareDepth(false);
  const cores = built.reveal.active.object.children.filter(
    (object) => object.visible && object.name.endsWith('-core'),
  );
  if (cores.length !== 1 || !(cores[0] instanceof LineSegments2))
    throw new Error('Expected one visible production active core');
  const core = cores[0];
  const camera = options.perspective
    ? new three.PerspectiveCamera(40, 4 / 3, 0.1, 100_000)
    : new three.OrthographicCamera(-80, 80, 40, -40, 0.1, 100_000);
  camera.position.set(50, 0, 130);
  camera.up.set(0, 1, 0);
  camera.lookAt(50, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  let uploaded: { projection: number[]; modelView: number[]; viewport: number[] } | null = null;
  core.onAfterRender = () => {
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    if (program === null) throw new Error('Missing actual active-core program');
    const matrix = (name: string) => {
      const location = gl.getUniformLocation(program, name);
      if (location === null) throw new Error('Missing uploaded matrix: ' + name);
      const value: unknown = gl.getUniform(program, location);
      if (!(value instanceof Float32Array) || value.length !== 16)
        throw new Error('Expected actual uploaded Float32 matrix: ' + name);
      return [...value];
    };
    uploaded = {
      projection: matrix('projectionMatrix'),
      modelView: matrix('modelViewMatrix'),
      viewport: [...(gl.getParameter(gl.VIEWPORT) as Int32Array)],
    };
  };
  try {
    if (built.reveal.solid?.depthBatches?.split !== false)
      throw new Error('Expected source-order physical writers');
    if (built.reveal.solid.geometry.instanceCount !== 0)
      throw new Error('Unexpected completed cut');
    if (!built.reveal.travelGhost?.visible) throw new Error('Native future ghost not admitted');
    renderer.render(scene, camera);
    const matrices = uploaded as {
      projection: number[];
      modelView: number[];
      viewport: number[];
    } | null;
    if (matrices === null) throw new Error('Active core did not draw');
    const placed = [...built.reveal.active.positions()];
    const [vx, vy, width, height] = matrices.viewport;
    if (
      vx !== 0 ||
      vy !== 0 ||
      width !== 800 * options.pixelRatio ||
      height !== 600 * options.pixelRatio
    )
      throw new Error('Unexpected actual active-core viewport');
    const mvp = new three.Matrix4()
      .fromArray(matrices.projection)
      .multiply(new three.Matrix4().fromArray(matrices.modelView));
    const project = (point: number[]) => {
      const clip = new three.Vector4(point[0], point[1], point[2], 1).applyMatrix4(mvp);
      if (clip.w <= 0 || Math.abs(clip.z) >= clip.w) throw new Error('Body point outside camera');
      return { x: ((clip.x / clip.w + 1) * width) / 2, y: ((1 - clip.y / clip.w) * height) / 2 };
    };
    const start = project(placed.slice(0, 3));
    const end = project(placed.slice(3));
    const sample = project([25, 0, 0.25]);
    const x = Math.floor(sample.x);
    const y = Math.floor(sample.y);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const l2 = dx * dx + dy * dy;
    const pixels = [y - 1, y].map((row) => {
      if (x < 0 || x >= width || row < 0 || row >= height) throw new Error('Out-of-bounds pixel');
      const corners = [
        [x, row],
        [x + 1, row],
        [x, row + 1],
        [x + 1, row + 1],
      ] as const;
      const fractions = corners.map(([cx, cy]) => ((cx - start.x) * dx + (cy - start.y) * dy) / l2);
      const distancesCSS = corners.map(
        ([cx, cy]) =>
          Math.abs((cx - start.x) * dy - (cy - start.y) * dx) / Math.sqrt(l2) / options.pixelRatio,
      );
      if (
        fractions.some((t) => t <= 0.1 || t >= 0.9) ||
        distancesCSS.some(
          (distance) => distance >= core.material.linewidth / 2 - 0.1 / options.pixelRatio,
        )
      )
        throw new Error('Pixel not wholly admitted in actual Float32 active body');
      const rgba = new Uint8Array(4);
      gl.readPixels(x, height - 1 - row, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return { pixel: [x, row], rgba: [...rgba], fractions, distancesCSS };
    });
    if (gl.getError() !== gl.NO_ERROR) throw new Error('GL error in body readback');
    const sourceGeometry = built.reveal.solid.geometry;
    const sourceStart = sourceGeometry.getAttribute('instanceStart');
    const sourceEnd = sourceGeometry.getAttribute('instanceEnd');
    const sourcePlane = sourceGeometry.getAttribute(DEPTH_PLANE_ATTRIBUTE).array;
    const sourceOffset = sourceGeometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array;
    const activePlane = core.geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE).array;
    const activeOffset = core.geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array;
    if (
      !(sourcePlane instanceof Float32Array) ||
      !(sourceOffset instanceof Float32Array) ||
      !(activePlane instanceof Float32Array) ||
      !(activeOffset instanceof Float32Array)
    )
      throw new Error('Expected actual stored Float32 source and active plane descriptors');
    const bits = (array: Float32Array, count: number): number[] => [
      ...new Uint32Array(array.buffer, array.byteOffset, count),
    ];
    // Control: rebuild from the actual short geometry alone, without sourceEnd metadata.
    const prefixStart = core.geometry.getAttribute('instanceStart');
    const prefixEnd = core.geometry.getAttribute('instanceEnd');
    const rebuiltPrefixPlane = new Float32Array(4);
    const rebuiltPrefixOffset = new Float32Array(1);
    writeDepthPlane(
      rebuiltPrefixPlane,
      0,
      prefixStart.getX(0),
      prefixStart.getY(0),
      prefixStart.getZ(0),
      prefixEnd.getX(0),
      prefixEnd.getY(0),
      prefixEnd.getZ(0),
      rebuiltPrefixOffset,
      0,
    );
    return {
      input: INPUT,
      options,
      matrices,
      placed,
      source: [...parsed.model.positions],
      prefixFraction,
      placedStorageFloat32: built.reveal.active.positions() instanceof Float32Array,
      sourceStorageFloat32:
        sourceStart.array instanceof Float32Array && sourceEnd.array instanceof Float32Array,
      sourceEndpoints: [
        sourceStart.getX(0),
        sourceStart.getY(0),
        sourceStart.getZ(0),
        sourceEnd.getX(0),
        sourceEnd.getY(0),
        sourceEnd.getZ(0),
      ],
      sourcePlane: [...sourcePlane.slice(0, 4)],
      sourcePlaneOffset: [...sourceOffset.slice(0, 1)],
      sourcePlaneBits: [...bits(sourcePlane, 4), ...bits(sourceOffset, 1)],
      activePlane: [...activePlane],
      activePlaneOffset: [...activeOffset],
      activePlaneBits: [...bits(activePlane, 4), ...bits(activeOffset, 1)],
      rebuiltPrefixPlane: [...rebuiltPrefixPlane],
      rebuiltPrefixPlaneOffset: [...rebuiltPrefixOffset],
      rebuiltPrefixPlaneBits: [...bits(rebuiltPrefixPlane, 4), ...bits(rebuiltPrefixOffset, 1)],
      nativePlanes: [
        ...built.reveal.travelGhost.geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE).array,
      ],
      nativePlaneOffsets: [
        ...built.reveal.travelGhost.geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array,
      ],
      core: core.name,
      widthCSS: core.material.linewidth,
      resolution: core.material.resolution.toArray(),
      samples: gl.getParameter(gl.SAMPLES) as number,
      pixels,
      data: renderer.domElement.toDataURL('image/png'),
    };
  } finally {
    disposeChildren(scene);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
