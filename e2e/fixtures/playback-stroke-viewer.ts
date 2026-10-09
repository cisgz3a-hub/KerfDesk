import * as three from 'three';
import { strokeCentrePixel } from './stroke-centre-pixel';
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
import { clipObjects } from '../../src/ui/viewer3d/scene-isolate';

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
  samples?: readonly Point[];
  vertical: boolean;
  look: Viewer3dLook;
  perspective: boolean;
  view?: 'top' | 'iso' | 'x-angle' | 'grazing';
  occluderZ?: number;
  liveMarker?: boolean;
  studioFurniture?: boolean;
  hideToolpath?: boolean;
  hideCompleted?: boolean;
  completedWidth?: number;
  /** Compare the fast branch with the exact source-ordered meshes from the same factory. */
  sourceOrder?: boolean;
  retainCurrentGhost?: boolean;
  clipMinX?: number;
  cameraFar?: number;
  cameraUp?: Point;
  pixelRatio?: number;
  viewport?: { width: number; height: number };
  cameraPose?: Point;
  cameraTarget?: Point;
}

/** Render production strokes and overlays with a fixed camera for repeatable pixel samples. */
export function playbackStrokeFrame(options: FrameOptions): {
  data: string;
  region: Region;
  regions: Region[];
  completedWidths: number[];
} {
  const parsed = buildGcodeRenderModel(options.text);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const width = options.viewport?.width ?? 800;
  const height = options.viewport?.height ?? 400;
  const renderer = new three.WebGLRenderer({ antialias: true });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(options.pixelRatio ?? 1);
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
  if (options.retainCurrentGhost && built.reveal.ghostTail)
    built.reveal.ghostTail.enabled.value = false;
  if (options.clipMinX !== undefined)
    clipObjects(group, [new three.Plane(new three.Vector3(1, 0, 0), -options.clipMinX)]);
  if (options.sourceOrder !== undefined) {
    if (built.reveal.solid?.depthBatches == null)
      throw new Error('Source-order comparison requires a mixed-depth batch');
    const strokes = built.objects.slice(1, 7);
    if (strokes.length !== 6 || strokes.some((object) => !('isLineSegments2' in object)))
      throw new Error('Expected original completed/ghost meshes followed by their depth batches');
    if (
      strokes[0]?.visible ||
      strokes.filter((object) => object.renderOrder === 1 && object.visible).length !== 2
    )
      throw new Error('Comparison input did not admit the fast depth branch');
    if (options.sourceOrder) built.reveal.active.useHardwareDepth(false);
    if (options.sourceOrder)
      for (const [index, stroke] of strokes.entries()) stroke.visible = index < 2;
  }
  if (options.hideCompleted) {
    if (built.reveal.solid !== null) built.reveal.solid.geometry.instanceCount = 0;
    if (built.reveal.solidGhost !== null) built.reveal.solidGhost.visible = false;
  }
  if (options.completedWidth !== undefined)
    for (const object of built.objects)
      if (object instanceof LineSegments2 && object.renderOrder === 1)
        object.material.linewidth = options.completedWidth;
  const completedWidths = built.objects.flatMap((object) =>
    object instanceof LineSegments2 && object.renderOrder === 1 && object.visible
      ? [object.material.linewidth]
      : [],
  );
  const camera = frameCamera(options, width, height);
  const rasterWidth = renderer.domElement.width;
  const rasterHeight = renderer.domElement.height;
  const region = sampleRegion(options, camera, rasterWidth, rasterHeight);
  const regions = (options.samples ?? [options.sample]).map((sample) =>
    sampleRegion({ ...options, sample }, camera, rasterWidth, rasterHeight),
  );
  try {
    if (options.samples !== undefined)
      for (const r of regions)
        if (r.x < 0 || r.y < 0 || r.x + r.width > rasterWidth || r.y + r.height > rasterHeight)
          throw new Error('Centreline sample outside the rendered viewport');
    renderer.render(scene, camera);
    // Read in the render's task: WebGL clears its drawing buffer at composite.
    return { data: renderer.domElement.toDataURL('image/png'), region, regions, completedWidths };
  } finally {
    disposeChildren(scene);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function strokeRegionColours(
  data: string,
  region: Region,
): ReturnType<typeof strokeRegionsColours> {
  return strokeRegionsColours(data, [region]);
}

export async function strokeRegionsColours(
  data: string,
  regions: readonly Region[],
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
  // Adjacent geometric samples may land on the same pixel; count each region once.
  const distinct = new Map(regions.map((r) => [JSON.stringify(r), r]));
  const pixels = [...distinct.values()].flatMap((region) => [
    ...context.getImageData(region.x, region.y, region.width, region.height).data,
  ]);
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
    ? new three.PerspectiveCamera(40, width / height, 0.1, options.cameraFar ?? 1_000)
    : new three.OrthographicCamera(-80, 80, 40, -40, 0.1, options.cameraFar ?? 1_000);
  const poses = {
    top: [50, 35, 110],
    iso: [160, -75, 110],
    'x-angle': [210, 35, 100],
    grazing: [310, 35, 40],
  } as const;
  const pose = poses[options.view ?? 'top'];
  const position = options.cameraPose ?? { x: pose[0], y: pose[1], z: pose[2] };
  const target = options.cameraTarget ?? { x: 50, y: 35, z: 0 };
  if (options.cameraUp) camera.up.set(options.cameraUp.x, options.cameraUp.y, options.cameraUp.z);
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(target.x, target.y, target.z);
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
  if (options.cameraPose !== undefined)
    return strokeCentrePixel(camera, options.sample, options.samples ?? [], width, height);
  if ((options.view ?? 'top') !== 'top' || options.liveMarker || options.studioFurniture)
    return { x: x - 1, y: y - 1, width: 2, height: 2 };
  return options.vertical
    ? { x: x - 1, y: y - 10, width: 2, height: 20 }
    : { x: x - 50, y: y - 1, width: 100, height: 2 };
}
