// Test support: relief scenes for the analytic G-code stock simulator
// (relief-gcode-stock.test-support.ts), ported from the rolling audit v12 X6
// refuter's harness (zz-x6r/x.mts).
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncTool,
  type Layer,
  type Polyline,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';

/** A height-map relief from depth below the top (≥ 0) at relief-local (x, y). */
export function stockRelief(options: {
  readonly w: number;
  readonly h: number;
  readonly px: number;
  readonly maxDepth: number;
  readonly at: readonly [number, number];
  readonly layer: string;
  readonly depth: (x: number, y: number) => number;
}): ReliefObject {
  const width = Math.round(options.w / options.px);
  const height = Math.round(options.h / options.px);
  const samplesU16: number[] = [];
  for (let j = 0; j < height; j += 1)
    for (let i = 0; i < width; i += 1) {
      const d = options.depth((i + 0.5) * options.px, (j + 0.5) * options.px);
      const clamped = Math.min(options.maxDepth, Math.max(0, d));
      samplesU16.push(Math.round(((options.maxDepth - clamped) / options.maxDepth) * 65535));
    }
  const [x, y] = options.at;
  return {
    kind: 'relief',
    id: 'rel',
    source: 'rel.png',
    color: '#a0522d',
    reliefSource: testReliefHeightfield({
      width,
      height,
      physicalWidthMm: options.w,
      physicalHeightMm: options.h,
      maxDepthMm: options.maxDepth,
      samplesU16,
    }),
    targetWidthMm: options.w,
    reliefDepthMm: options.maxDepth,
    bounds: { minX: x, minY: y, maxX: x + options.w, maxY: y + options.h },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    operationIds: [options.layer],
  } as ReliefObject;
}

export function circleLoop(cx: number, cy: number, r: number, n = 120): Polyline {
  const points = Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n),
    y: cy + r * Math.sin((2 * Math.PI * i) / n),
  }));
  return { closed: true, points };
}

export function squareLoop(x: number, y: number, w: number): Polyline {
  const points = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + w },
    { x, y: y + w },
  ];
  return { closed: true, points };
}

export function vectorObject(layer: string, polylines: ReadonlyArray<Polyline>): SceneObject {
  const xs = polylines.flatMap((line) => line.points.map((p) => p.x));
  const ys = polylines.flatMap((line) => line.points.map((p) => p.y));
  return {
    kind: 'imported-svg',
    id: 'vec',
    source: 'vec.svg',
    operationIds: [layer],
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
  } as SceneObject;
}

export function cncLayer(id: string, cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id, color: id === 'r' ? '#a0522d' : '#000000', name: id }),
    output: true,
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
}

export function stockProject(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  stockMm: number,
  extraTools: ReadonlyArray<CncTool> = [],
): Project {
  const base = createProject();
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, ...extraTools],
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: stockMm },
    },
    scene: { ...base.scene, objects, artworkOrder: objects.map((o) => o.id), layers },
  } as Project;
}
