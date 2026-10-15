/* global document, requestAnimationFrame */
// Browser half of the isolated, bundled renderer probe. Synthetic geometry is
// deliberate: actual user tracing belongs to the independent application e2e.
import { createProject } from '../../src/core/scene/project';
import { createDisplayPolylineCache } from '../../src/ui/workspace/display-polylines';
import { computeView } from '../../src/ui/workspace/view-transform';
let project;
let originalObject;
let projectBefore;
let variants;
const baselinePixels = new Map();

export function configure(value) {
  variants = value;
}

export async function prepare(base) {
  const polylines = Array.from({ length: 1500 }, (_, shape) => ({
    closed: true,
    points: Array.from({ length: 120 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 120;
      const radius = 2.2 + 0.4 * Math.sin(angle * 7 + shape);
      return {
        x: 3 + (shape % 50) * 6 + Math.cos(angle) * radius,
        y: 5 + Math.floor(shape / 50) * 10 + Math.sin(angle) * radius,
      };
    }),
  }));
  const layer = {
    ...base.scene.layers[0],
    id: 'dense-trace-fill',
    color: '#000000',
    mode: 'fill',
    hatchSpacingMm: 2,
  };
  originalObject = {
    ...base.scene.objects[0],
    kind: 'traced-image',
    id: 'synthetic-dense-trace',
    source: 'deterministic-1500-rounded-contours',
    operationIds: [layer.id],
    traceMode: 'filled-contours',
    tracePixelWidth: 3000,
    tracePixelHeight: 3000,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    paths: [{ color: '#000000', polylines }],
    transform: { ...base.scene.objects[0].transform },
  };
  const defaults = createProject();
  project = {
    ...defaults,
    device: { ...defaults.device, ...base.device },
    workspace: { ...defaults.workspace, width: 300, height: 300 },
    scene: { objects: [originalObject], layers: [layer] },
  };
  projectBefore = await hash(JSON.stringify(project));
  return {
    fixture: 'Synthetic dense Fill trace, 1500 rounded contours, 120 points each',
    paths: 1,
    polylines: polylines.length,
    vertices: polylines.reduce((sum, line) => sum + line.points.length, 0),
    projectSha256: projectBefore,
  };
}

export async function measure({ variant, size }) {
  const { draw, cache } = variants[variant];
  cache.resetArtworkSpritesForTests();
  const previousCanvas = document.querySelector('#workspace');
  const canvas = document.createElement('canvas');
  canvas.id = 'workspace';
  previousCanvas.replaceWith(canvas);
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Canvas2D unavailable');
  const displayPolylineCache = createDisplayPolylineCache();
  const baseView = { zoomFactor: 4, panX: 0, panY: 0 };
  const scale = computeView(size.width, size.height, 300, 300, baseView).scale;
  const paint = (view, object = originalObject) => {
    const current = { ...project, scene: { ...project.scene, objects: [object] } };
    const started = performance.now();
    draw.drawScene(context, size.width, size.height, current, {
      selectedId: null,
      preview: false,
      displayPolylineCache,
      view,
    });
    return { drawJsMs: performance.now() - started };
  };
  const initial = paint(baseView);
  const initialCache = { ...cache.stats };
  const phases = [];
  for (const kind of ['pan', 'zoom', 'move']) {
    cache.resetArtworkSpritesForTests();
    paint(baseView);
    cache.clearStats();
    const samples = [];
    const frameIntervals = [];
    let previousFrame = await nextFrame();
    for (let index = 0; index < 12; index += 1) {
      const shift = Math.round(30 * Math.sin(((index + 1) * Math.PI) / 6));
      const view =
        kind === 'pan'
          ? { ...baseView, panX: shift / scale, panY: Math.round(shift / 2) / scale }
          : kind === 'zoom'
            ? { ...baseView, zoomFactor: 4 + (index + 1) * 0.01 }
            : baseView;
      const object =
        kind === 'move'
          ? {
              ...originalObject,
              transform: {
                ...originalObject.transform,
                x: shift / scale,
                y: Math.round(shift / 2) / scale,
              },
            }
          : originalObject;
      samples.push(paint(view, object));
      const frame = await nextFrame();
      frameIntervals.push(frame - previousFrame);
      previousFrame = frame;
    }
    phases.push({
      kind,
      samples: samples.length,
      drawJsMs: distribution(samples.map((value) => value.drawJsMs)),
      frameIntervalMs: distribution(frameIntervals),
      cache: { ...cache.stats },
    });
  }
  cache.resetArtworkSpritesForTests();
  paint(baseView);
  // Repeated readbacks can change Chromium's Canvas2D backend. Flush only the
  // final image, outside the interaction samples, for a visual comparison.
  const readbackStarted = performance.now();
  const pixels = context.getImageData(0, 0, size.width, size.height).data;
  const settledReadbackMs = performance.now() - readbackStarted;
  const settledPixelSha256 = await hash(pixels);
  let settledPixelComparison = null;
  if (variant === 'baseline') baselinePixels.set(size.width, pixels);
  else {
    const reference = baselinePixels.get(size.width);
    let changedChannels = 0;
    let maximumChannelDelta = 0;
    for (let index = 0; index < pixels.length; index += 1) {
      const delta = Math.abs(pixels[index] - reference[index]);
      if (delta !== 0) changedChannels += 1;
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
    }
    settledPixelComparison = { changedChannels, totalChannels: pixels.length, maximumChannelDelta };
    baselinePixels.delete(size.width);
  }
  return {
    variant,
    size,
    initial,
    initialCache,
    phases,
    settledReadbackMs,
    settledPixelSha256,
    settledPixelComparison,
  };
}

export async function verifyPreservation() {
  return {
    projectBefore,
    projectAfter: await hash(JSON.stringify(project)),
    scope:
      'Exact project, source geometry, operation settings and transforms; emitted G-code is not recomputed by this rendering probe.',
  };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    max: sorted.at(-1),
  };
}

async function hash(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
