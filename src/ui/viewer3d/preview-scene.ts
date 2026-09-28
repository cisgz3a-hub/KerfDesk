// The picture the Inspector shows while its worker reads a program (ADR-485):
// the moves read so far, in Classic's colours as one-pixel lines, framed from
// the Iso view as the job grows. It has no controls, picking or lenses; the
// full view replaces it the moment the program is ready.
//
// Its cost stays in step with what is new. Each batch is drawn once, over the
// picture already on the canvas, rather than redrawing every move read so far
// a few times a second. Only a reframe redraws the lot, and the frame leaves
// room on the side the job is growing toward, so a job read line by line
// reframes a few dozen times at most, not once per batch.

import type * as ThreeNamespace from 'three';
import type { AxisBounds } from '../../core/gcode-view';
import { cameraPlacement, VIEWER3D_FOV_DEG } from './camera-presets';
import { rgbTriple } from './segment-buckets';
import { TRAVEL_OPACITY } from './scene-toolpath';
import { disposeViewer3dRenderer } from './viewer3d-context';
import { loadThree, type ThreeModules } from './viewer3d-modules';
import { resolveViewer3dTheme } from './viewer3d-theme';

const FLOATS_PER_POINT = 3;
const MAX_PIXEL_RATIO = 2;
// Moves drawn since the last frame carry this layer as well as the default.
const NEW_LAYER = 1;
// How much room the frame leaves past a side the job has grown across.
const GROWTH_ROOM = 0.5;

/** One batch of moves: x0 y0 z0 x1 y1 z1 each. */
export type PreviewLines = {
  readonly solid: Float32Array;
  readonly travel: Float32Array;
};

export type PreviewScene = {
  readonly add: (lines: PreviewLines) => void;
  readonly resize: (width: number, height: number) => void;
  readonly dispose: () => void;
};

export async function createPreviewScene(canvas: HTMLCanvasElement): Promise<PreviewScene | null> {
  const modules = await loadThree();
  const { three } = modules;
  const theme = resolveViewer3dTheme(canvas);
  const renderer = openRenderer(three, canvas, theme.background);
  if (renderer === null) return null;
  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(VIEWER3D_FOV_DEG, 1, 0.1, 100_000);
  camera.up.set(0, 0, 1);
  const materials = previewMaterials(three, theme);
  const bounds = createBounds();
  const size = { width: 0, height: 0 };
  const fresh: ThreeNamespace.Object3D[] = [];
  let framed: AxisBounds | null = null;
  let redraw = true;
  let frame = 0;

  const draw = (): void => {
    frame = 0;
    if (size.width === 0) return;
    if (redraw) {
      renderer.clear();
      camera.layers.set(0);
    } else {
      camera.layers.set(NEW_LAYER);
    }
    renderer.render(scene, camera);
    for (const object of fresh) object.layers.disable(NEW_LAYER);
    fresh.length = 0;
    redraw = false;
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(draw);
  };
  const frameJob = (): void => {
    const placement = cameraPlacement('iso', framed, size.width / Math.max(1, size.height));
    camera.position.set(placement.position.x, placement.position.y, placement.position.z);
    camera.lookAt(placement.target.x, placement.target.y, placement.target.z);
    redraw = true;
  };

  return {
    add: (lines) => {
      for (const object of lineObjects(modules, lines, materials)) {
        object.layers.enable(NEW_LAYER);
        scene.add(object);
        fresh.push(object);
      }
      bounds.include(lines.solid);
      bounds.include(lines.travel);
      const job = bounds.value();
      if (job !== null && !contains(framed, job)) {
        framed = withRoom(framed, job);
        frameJob();
      }
      schedule();
    },
    resize: (width, height) => {
      if (width <= 0 || height <= 0) return;
      size.width = width;
      size.height = height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      frameJob();
      schedule();
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      scene.traverse((object) => {
        (object as { geometry?: { dispose: () => void } }).geometry?.dispose();
      });
      scene.clear();
      materials.solid.dispose();
      materials.travel.dispose();
      disposeViewer3dRenderer(renderer);
    },
  };
}

// The picture builds up across frames, so the canvas keeps each one.
function openRenderer(
  three: ThreeModules['three'],
  canvas: HTMLCanvasElement,
  background: number,
): ThreeNamespace.WebGLRenderer | null {
  let renderer: ThreeNamespace.WebGLRenderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(background);
  return renderer;
}

type PreviewMaterials = {
  readonly solid: ThreeNamespace.LineBasicMaterial;
  readonly travel: ThreeNamespace.LineBasicMaterial;
};

function previewMaterials(
  three: ThreeModules['three'],
  theme: ReturnType<typeof resolveViewer3dTheme>,
): PreviewMaterials {
  // Classic's solid lines read their raw colour as linear light (ADR-425).
  const solid = new three.LineBasicMaterial({ toneMapped: false });
  solid.color.setRGB(...rgbTriple(theme.cut), three.LinearSRGBColorSpace);
  const travel = new three.LineBasicMaterial({
    color: theme.travel,
    transparent: true,
    opacity: TRAVEL_OPACITY,
    toneMapped: false,
  });
  return { solid, travel };
}

function lineObjects(
  modules: ThreeModules,
  lines: PreviewLines,
  materials: PreviewMaterials,
): ThreeNamespace.LineSegments[] {
  const { three } = modules;
  const objects: ThreeNamespace.LineSegments[] = [];
  for (const [positions, material] of [
    [lines.travel, materials.travel],
    [lines.solid, materials.solid],
  ] as const) {
    if (positions.length === 0) continue;
    const geometry = new three.BufferGeometry();
    geometry.setAttribute('position', new three.BufferAttribute(positions, FLOATS_PER_POINT));
    const object = new three.LineSegments(geometry, material);
    // The picture is always whole on screen, so nothing is culled.
    object.frustumCulled = false;
    objects.push(object);
  }
  return objects;
}

function contains(outer: AxisBounds | null, inner: AxisBounds): boolean {
  return (
    outer !== null &&
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.minZ >= outer.minZ &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY &&
    inner.maxZ <= outer.maxZ
  );
}

/**
 * The job's box, with room past each side the job has grown across since the
 * last frame: half the job's size along that axis.
 */
export function withRoom(previous: AxisBounds | null, job: AxisBounds): AxisBounds {
  if (previous === null) return job;
  const room = (axis: 'X' | 'Y' | 'Z'): number =>
    (job[`max${axis}`] - job[`min${axis}`]) * GROWTH_ROOM;
  const low = (axis: 'X' | 'Y' | 'Z'): number =>
    job[`min${axis}`] < previous[`min${axis}`]
      ? job[`min${axis}`] - room(axis)
      : previous[`min${axis}`];
  const high = (axis: 'X' | 'Y' | 'Z'): number =>
    job[`max${axis}`] > previous[`max${axis}`]
      ? job[`max${axis}`] + room(axis)
      : previous[`max${axis}`];
  return {
    minX: low('X'),
    minY: low('Y'),
    minZ: low('Z'),
    maxX: high('X'),
    maxY: high('Y'),
    maxZ: high('Z'),
  };
}

// The box around every move added so far.
function createBounds(): {
  readonly include: (positions: Float32Array) => void;
  readonly value: () => AxisBounds | null;
} {
  const box = { minX: Infinity, minY: Infinity, minZ: Infinity };
  const top = { maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  return {
    include: (positions) => {
      for (let at = 0; at < positions.length; at += FLOATS_PER_POINT) {
        const x = positions[at] ?? 0;
        const y = positions[at + 1] ?? 0;
        const z = positions[at + 2] ?? 0;
        if (x < box.minX) box.minX = x;
        if (y < box.minY) box.minY = y;
        if (z < box.minZ) box.minZ = z;
        if (x > top.maxX) top.maxX = x;
        if (y > top.maxY) top.maxY = y;
        if (z > top.maxZ) top.maxZ = z;
      }
    },
    value: () => (Number.isFinite(box.minX) ? { ...box, ...top } : null),
  };
}
