import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { buildGcodeRenderModel } from '../../src/core/gcode-view';
import { disposeChildren } from '../../src/ui/viewer3d/scene-furniture';
import {
  applyRecolor,
  applyReveal,
  buildToolpathObjects,
} from '../../src/ui/viewer3d/scene-toolpath';
import { applyTravelLook } from '../../src/ui/viewer3d/scene-travel-look';
import { srgbToLinear, type Viewer3dLook } from '../../src/ui/viewer3d/viewer3d-look';
import { resolveViewer3dTheme } from '../../src/ui/viewer3d/viewer3d-theme';

interface Point {
  x: number;
  y: number;
  z: number;
}
interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Render the production strokes with a fixed camera so pixel samples are repeatable. */
export function playbackStrokeFrame(options: {
  text: string;
  segmentIndex: number;
  point: Point;
  sample: Point;
  vertical: boolean;
  look: Viewer3dLook;
  perspective: boolean;
}): { data: string; region: Region } {
  const parsed = buildGcodeRenderModel(options.text);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const width = 800;
  const height = 400;
  const renderer = new three.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  const theme = resolveViewer3dTheme();
  renderer.setClearColor(theme.background);
  const scene = new three.Scene();
  const group = new three.Group();
  scene.add(group);
  const built = buildToolpathObjects({
    three,
    LineMaterial,
    LineSegments2,
    LineSegmentsGeometry,
    segments: parsed.model,
    theme,
    viewWidth: width,
    viewHeight: height,
    travelVisible: true,
  });
  group.add(...built.objects);
  applyTravelLook(three, built.travelLine, options.look, theme, 100);
  if (options.look === 'studio')
    applyRecolor(built.reveal, () => [79 / 255, 163 / 255, 1], srgbToLinear);
  applyReveal(built.reveal, { segmentIndex: options.segmentIndex, point: options.point });
  const camera = options.perspective
    ? new three.PerspectiveCamera(40, width / height, 0.1, 1_000)
    : new three.OrthographicCamera(-80, 80, 40, -40, 0.1, 1_000);
  camera.position.set(50, 35, 110);
  camera.lookAt(50, 35, 0);
  camera.updateMatrixWorld();
  const projected = new three.Vector3(options.sample.x, options.sample.y, options.sample.z).project(
    camera,
  );
  const x = Math.round(((projected.x + 1) / 2) * width);
  const y = Math.round(((1 - projected.y) / 2) * height);
  const region = options.vertical
    ? { x: x - 1, y: y - 10, width: 2, height: 20 }
    : { x: x - 50, y: y - 1, width: 100, height: 2 };
  try {
    renderer.render(scene, camera);
    // Read in the render's task: WebGL clears its drawing buffer at composite.
    return { data: renderer.domElement.toDataURL('image/png'), region };
  } finally {
    disposeChildren(group);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function strokeRegionColours(
  data: string,
  region: Region,
): Promise<{
  cut: number;
  white: number;
  total: number;
}> {
  const image = new Image();
  image.src = data;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Screenshot decoder unavailable');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(region.x, region.y, region.width, region.height).data;
  let cut = 0;
  let white = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at] ?? 0;
    const g = pixels[at + 1] ?? 0;
    const b = pixels[at + 2] ?? 0;
    if (b > r + 20 && b > g + 8) cut += 1;
    if (r > 230 && g > 230 && b > 230) white += 1;
  }
  return { cut, white, total: pixels.length / 4 };
}
