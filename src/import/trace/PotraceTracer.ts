/**
 * Image tracing via imagetracerjs (potrace-compatible POINT/CURVE output).
 * Thresholded bitmap on canvas → trace → SubPaths (POINT / CURVE from getPaths).
 * Async path runs imagetracerjs in a Web Worker (see `trace.worker.ts`).
 */
import { getPaths, traceCanvas } from './ImageTracerAdapter';
import type { TraceWorkerMessageIn } from './trace.worker';
import {
  type SceneObject,
  type PathGeometry,
  type SubPath,
  type PathSegment,
} from '../../core/scene/SceneObject';
import { generateId, IDENTITY_MATRIX } from '../../core/types';

export interface TraceOptions {
  threshold: number;
  turdsize: number;
  alphamax: number;
  opttolerance: number;
  invert: boolean;
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  threshold: 128,
  turdsize: 8,
  alphamax: 1.0,
  opttolerance: 0.2,
  invert: false,
};

export interface PotraceItem {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

const TRACE_CLOSE_TOLERANCE_PX = 1.5;

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function contourToSubPath(items: PotraceItem[]): SubPath | null {
  if (items.length < 2) return null;
  const segments: PathSegment[] = [];
  const first = items[0];
  if (first.type !== 'POINT' || first.x === undefined || first.y === undefined) return null;

  const firstPoint = { x: first.x, y: first.y };
  let lastPoint = firstPoint;
  segments.push({ type: 'move', to: firstPoint });

  for (let i = 1; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'CURVE') {
      if (
        it.x1 == null || it.y1 == null || it.x2 == null || it.y2 == null ||
        it.x == null || it.y == null
      ) continue;
      segments.push({
        type: 'cubic',
        cp1: { x: it.x1, y: it.y1 },
        cp2: { x: it.x2, y: it.y2 },
        to: { x: it.x, y: it.y },
      });
      lastPoint = { x: it.x, y: it.y };
    } else if (it.type === 'POINT' && it.x != null && it.y != null) {
      segments.push({ type: 'line', to: { x: it.x, y: it.y } });
      lastPoint = { x: it.x, y: it.y };
    }
  }

  const closed = distance(lastPoint, firstPoint) <= TRACE_CLOSE_TOLERANCE_PX;
  if (closed) {
    segments.push({ type: 'close' });
  }
  return { segments, closed };
}

/**
 * Trace grayscale pixel data into a SceneObject path.
 * Returns null if no contours found.
 */
export function traceToSceneObject(
  grayscaleData: Uint8Array,
  width: number,
  height: number,
  options: TraceOptions,
  layerId: string,
  sourceName: string
): SceneObject | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(width, height);

  for (let i = 0; i < grayscaleData.length; i++) {
    let v = grayscaleData[i];
    if (options.invert) v = 255 - v;
    const bw = v < options.threshold ? 0 : 255;
    imgData.data[i * 4] = bw;
    imgData.data[i * 4 + 1] = bw;
    imgData.data[i * 4 + 2] = bw;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  const pathList = traceCanvas(canvas, {
    turdsize: options.turdsize,
    alphamax: options.alphamax,
    opttolerance: options.opttolerance,
    optcurve: true,
    turnpolicy: 'minority',
  });

  const rawPaths = getPaths(pathList) as PotraceItem[][];
  const subPaths: SubPath[] = [];

  for (const items of rawPaths) {
    const sp = contourToSubPath(items);
    if (sp) subPaths.push(sp);
  }

  if (subPaths.length === 0) return null;

  return {
    id: generateId(),
    type: 'path',
    name: 'Traced ' + sourceName,
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: {
      type: 'path',
      subPaths,
    } as PathGeometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

let traceWorkerInstance: Worker | null = null;
let traceWorkerRequestId = 0;

function getTraceWorker(): Worker {
  if (!traceWorkerInstance) {
    traceWorkerInstance = new Worker(
      new URL('./trace.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return traceWorkerInstance;
}

/**
 * Async version of traceToSceneObject — runs imagetracerjs in a Web Worker.
 * UI stays responsive during tracing.
 */
export function traceToSceneObjectAsync(
  grayscaleData: Uint8Array,
  width: number,
  height: number,
  options: TraceOptions,
  layerId: string,
  sourceName: string,
): Promise<SceneObject | null> {
  return new Promise((resolve) => {
    const worker = getTraceWorker();
    const id = ++traceWorkerRequestId;

    const onMessage = (ev: MessageEvent<{ id: number; contours: PotraceItem[][] }>) => {
      if (ev.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);

      const { contours } = ev.data;
      const subPaths: SubPath[] = [];
      for (const items of contours) {
        const sp = contourToSubPath(items);
        if (sp) subPaths.push(sp);
      }

      if (subPaths.length === 0) {
        resolve(null);
        return;
      }

      resolve({
        id: generateId(),
        type: 'path',
        name: 'Traced ' + sourceName,
        layerId,
        parentId: null,
        transform: { ...IDENTITY_MATRIX },
        geometry: { type: 'path', subPaths } as PathGeometry,
        visible: true,
        locked: false,
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      });
    };

    const onError = (err: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      console.error('[trace worker] Error:', err.message, err);
      resolve(null);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    const payload: TraceWorkerMessageIn = {
      id,
      grayscaleData,
      width,
      height,
      options,
    };
    worker.postMessage(payload);
  });
}
