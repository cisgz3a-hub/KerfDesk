import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildGcodeRenderModel } from '../../src/core/gcode-view';
import { disposeChildren } from '../../src/ui/viewer3d/scene-furniture';
import { createMarkers, sizeMarkers } from '../../src/ui/viewer3d/scene-markers';
import type { Viewer3dSegmentsInput } from '../../src/ui/viewer3d/segment-buckets';
import { buildStudioFurniture } from '../../src/ui/viewer3d/studio-furniture';
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

interface FrameOptions {
  text: string;
  segmentIndex: number;
  point: Point;
  sample: Point;
  vertical: boolean;
  look: Viewer3dLook;
  perspective: boolean;
  view?: 'top' | 'iso' | 'x-angle' | 'grazing';
  occluderZ?: number;
  liveMarker?: boolean;
  studioFurniture?: boolean;
  hideToolpath?: boolean;
}

/** Render production strokes and overlays with a fixed camera for repeatable pixel samples. */
export function playbackStrokeFrame(options: FrameOptions): { data: string; region: Region } {
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
  group.visible = !options.hideToolpath;
  addOverlays(scene, parsed.model, options);
  if (options.occluderZ !== undefined) group.add(sceneOccluder(0xf59f42, options.occluderZ));
  applyTravelLook(three, built.travelLine, options.look, theme, 100);
  if (options.look === 'studio')
    applyRecolor(built.reveal, () => [79 / 255, 163 / 255, 1], srgbToLinear);
  applyReveal(built.reveal, { segmentIndex: options.segmentIndex, point: options.point });
  const camera = frameCamera(options, width, height);
  const region = sampleRegion(options, camera, width, height);
  try {
    renderer.render(scene, camera);
    // Read in the render's task: WebGL clears its drawing buffer at composite.
    return { data: renderer.domElement.toDataURL('image/png'), region };
  } finally {
    disposeChildren(scene);
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
  occluder: number;
  live: number;
  origin: number;
  axis: number;
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
  let occluder = 0;
  let live = 0;
  let origin = 0;
  let axis = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at] ?? 0;
    const g = pixels[at + 1] ?? 0;
    const b = pixels[at + 2] ?? 0;
    if (b > r + 20 && b > g + 8) cut += 1;
    if (r > 230 && g > 230 && b > 230) white += 1;
    if (r > 200 && g > 90 && g < 200 && b < 100) occluder += 1;
    if (r === 255 && g === 45 && b === 45) live += 1;
    if (r === 232 && g === 228 && b === 222) origin += 1;
    if (r === 217 && g === 119 && b === 111) axis += 1;
  }
  return { cut, white, occluder, live, origin, axis, total: pixels.length / 4 };
}

function sceneOccluder(color: number, z: number): three.Mesh {
  const plane = new three.Mesh(
    new three.PlaneGeometry(160, 120),
    new three.MeshBasicMaterial({ color, toneMapped: false }),
  );
  plane.position.set(50, 35, z);
  return plane;
}

function addOverlays(
  scene: three.Scene,
  segments: Viewer3dSegmentsInput,
  options: FrameOptions,
): void {
  if (options.liveMarker) {
    const markers = createMarkers(three, scene);
    sizeMarkers(markers, segments);
    markers.liveMarker.position.set(options.sample.x, options.sample.y, options.sample.z);
    markers.liveMarker.visible = true;
  }
  if (options.studioFurniture)
    scene.add(
      buildStudioFurniture(three, CSS2DObject, { bounds: null, jobBox: null, workArea: null }),
    );
}

function frameCamera(options: FrameOptions, width: number, height: number): three.Camera {
  const camera = options.perspective
    ? new three.PerspectiveCamera(40, width / height, 0.1, 1_000)
    : new three.OrthographicCamera(-80, 80, 40, -40, 0.1, 1_000);
  const poses = {
    top: [50, 35, 110],
    iso: [160, -75, 110],
    'x-angle': [210, 35, 100],
    grazing: [310, 35, 40],
  } as const;
  const pose = poses[options.view ?? 'top'];
  camera.position.set(pose[0], pose[1], pose[2]);
  camera.lookAt(50, 35, 0);
  camera.updateMatrixWorld();
  return camera;
}

function sampleRegion(
  options: FrameOptions,
  camera: three.Camera,
  width: number,
  height: number,
): Region {
  const projected = new three.Vector3(options.sample.x, options.sample.y, options.sample.z).project(
    camera,
  );
  const x = Math.round(((projected.x + 1) / 2) * width);
  const y = Math.round(((1 - projected.y) / 2) * height);
  if ((options.view ?? 'top') !== 'top' || options.liveMarker || options.studioFurniture)
    return { x: x - 1, y: y - 1, width: 2, height: 2 };
  return options.vertical
    ? { x: x - 1, y: y - 10, width: 2, height: 20 }
    : { x: x - 50, y: y - 1, width: 100, height: 2 };
}
