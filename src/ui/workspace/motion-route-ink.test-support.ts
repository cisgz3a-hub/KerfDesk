// A small software 2D canvas for the burn-route tests (jsdom has no raster
// backend and the repo carries no native canvas package).
//
// It rasterizes exactly the subset the route raster uses — setTransform,
// stroke(Path2D) with width/cap/alpha, clearRect and drawImage (1:1 or scaled,
// nearest-neighbour) — into premultiplied RGBA floats. A stroke is one shape:
// per-pixel coverage is the union (max) over its segments with a one-pixel box
// filter at the edge, then composited once with source-over, which is the
// property the opaque-into-raster design depends on. Dashes are drawn solid.
// This is geometric evidence (same segments, same widths, same compositing),
// not a claim about Skia's exact antialiasing.

import { vi } from 'vitest';

/** Path2D stand-in that keeps its subpaths as flat coordinate lists. */
export class InkPath2D {
  static moveTos = 0;
  static lineTos = 0;
  readonly subpaths: number[][] = [];

  moveTo(x: number, y: number): void {
    InkPath2D.moveTos += 1;
    this.subpaths.push([x, y]);
  }

  lineTo(x: number, y: number): void {
    InkPath2D.lineTos += 1;
    const last = this.subpaths[this.subpaths.length - 1];
    if (last === undefined) this.subpaths.push([x, y]);
    else last.push(x, y);
  }

  segmentCount(): number {
    return this.subpaths.reduce((sum, points) => sum + Math.max(0, points.length / 2 - 1), 0);
  }
}

export type InkOp =
  | { readonly kind: 'stroke'; readonly segments: number; readonly widthPx: number }
  | { readonly kind: 'drawImage'; readonly args: ReadonlyArray<number> }
  | { readonly kind: 'clear' };

type InkState = {
  transform: [number, number, number, number, number, number];
  alpha: number;
  color: [number, number, number, number];
  lineWidth: number;
  lineCap: CanvasLineCap;
};

const contexts = new WeakMap<HTMLCanvasElement, InkContext>();

export class InkContext {
  readonly ops: InkOp[] = [];
  /** Called for every stroke with its segment count and device width (a cost proxy). */
  static onStroke: (segments: number, widthPx: number) => void = () => undefined;
  private data = new Float32Array(0);
  private dataWidth = 0;
  private dataHeight = 0;
  private state: InkState = defaultState();
  private readonly stack: InkState[] = [];
  private immediate = new InkPath2D();

  constructor(readonly canvas: HTMLCanvasElement) {}

  get globalAlpha(): number {
    return this.state.alpha;
  }
  set globalAlpha(value: number) {
    this.state.alpha = value;
  }
  set strokeStyle(value: string) {
    this.state.color = parseColor(value);
  }
  set lineWidth(value: number) {
    this.state.lineWidth = value;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineCap(value: CanvasLineCap) {
    this.state.lineCap = value;
  }
  get lineCap(): CanvasLineCap {
    return this.state.lineCap;
  }
  set lineJoin(_value: CanvasLineJoin) {
    // Joins are the union of the segment capsules either way.
  }

  save(): void {
    this.stack.push({ ...this.state, transform: [...this.state.transform] });
  }
  restore(): void {
    this.state = this.stack.pop() ?? this.state;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.transform = [a, b, c, d, e, f];
  }
  setLineDash(_dash: number[]): void {
    // Solid on purpose; see the header.
  }
  beginPath(): void {
    this.immediate = new InkPath2D();
  }
  moveTo(x: number, y: number): void {
    this.immediate.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.immediate.lineTo(x, y);
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    const data = this.pixels();
    for (let py = Math.max(0, y); py < Math.min(this.dataHeight, y + height); py += 1) {
      for (let px = Math.max(0, x); px < Math.min(this.dataWidth, x + width); px += 1) {
        data.fill(0, (py * this.dataWidth + px) * 4, (py * this.dataWidth + px) * 4 + 4);
      }
    }
    this.ops.push({ kind: 'clear' });
  }

  stroke(path?: InkPath2D): void {
    const target = path ?? this.immediate;
    const [a, b, c, d, e, f] = this.state.transform;
    const scale = Math.sqrt(Math.abs(a * d - b * c));
    const widthPx = this.state.lineWidth * scale;
    this.pixels();
    const coverage = new Float32Array(this.dataWidth * this.dataHeight);
    const butt = this.state.lineCap === 'butt';
    for (const points of target.subpaths) {
      for (let index = 2; index + 1 < points.length; index += 2) {
        const x0 = points[index - 2] ?? 0;
        const y0 = points[index - 1] ?? 0;
        const x1 = points[index] ?? 0;
        const y1 = points[index + 1] ?? 0;
        rasterizeSegment(
          { coverage, width: this.dataWidth, height: this.dataHeight },
          [a * x0 + c * y0 + e, b * x0 + d * y0 + f, a * x1 + c * y1 + e, b * x1 + d * y1 + f],
          {
            half: widthPx / 2,
            // Only a subpath's own ends are capped; inner vertices are joins.
            buttStart: butt && index === 2,
            buttEnd: butt && index + 2 >= points.length,
          },
        );
      }
    }
    this.composite(coverage);
    const segments = target.segmentCount();
    InkContext.onStroke(segments, widthPx);
    this.ops.push({ kind: 'stroke', segments, widthPx });
  }

  drawImage(source: HTMLCanvasElement, dx: number, dy: number, dw?: number, dh?: number): void {
    const from = inkContextOf(source);
    const sourcePixels = from.pixels();
    const width = dw ?? source.width;
    const height = dh ?? source.height;
    const data = this.pixels();
    for (let py = 0; py < this.dataHeight; py += 1) {
      const sy = Math.floor(((py + 0.5 - dy) * source.height) / height);
      if (sy < 0 || sy >= source.height) continue;
      for (let px = 0; px < this.dataWidth; px += 1) {
        const sx = Math.floor(((px + 0.5 - dx) * source.width) / width);
        if (sx < 0 || sx >= source.width) continue;
        blendPixel(
          data,
          (py * this.dataWidth + px) * 4,
          sourcePixels,
          (sy * source.width + sx) * 4,
          this.state.alpha,
        );
      }
    }
    this.ops.push({
      kind: 'drawImage',
      args: dw === undefined ? [dx, dy] : [dx, dy, width, height],
    });
  }

  /** Premultiplied RGBA floats, reallocated (cleared) when the canvas is resized. */
  pixels(): Float32Array {
    if (this.dataWidth !== this.canvas.width || this.dataHeight !== this.canvas.height) {
      this.dataWidth = this.canvas.width;
      this.dataHeight = this.canvas.height;
      this.data = new Float32Array(this.dataWidth * this.dataHeight * 4);
    }
    return this.data;
  }

  private composite(coverage: Float32Array): void {
    const data = this.pixels();
    const [r, g, b, colorAlpha] = this.state.color;
    for (let index = 0; index < coverage.length; index += 1) {
      const alpha = (coverage[index] ?? 0) * this.state.alpha * colorAlpha;
      if (alpha <= 0) continue;
      const t = index * 4;
      data[t] = r * alpha + (data[t] ?? 0) * (1 - alpha);
      data[t + 1] = g * alpha + (data[t + 1] ?? 0) * (1 - alpha);
      data[t + 2] = b * alpha + (data[t + 2] ?? 0) * (1 - alpha);
      data[t + 3] = alpha + (data[t + 3] ?? 0) * (1 - alpha);
    }
  }
}

/** Routes every 2D context (visible and offscreen) and Path2D through the ink model. */
export function installInkCanvas(): void {
  InkPath2D.moveTos = 0;
  InkPath2D.lineTos = 0;
  vi.stubGlobal('Path2D', InkPath2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function inkContext(
    this: HTMLCanvasElement,
  ) {
    return inkContextOf(this) as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext']);
}

export function inkCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function inkContextOf(canvas: HTMLCanvasElement): InkContext {
  let context = contexts.get(canvas);
  if (context === undefined) {
    context = new InkContext(canvas);
    contexts.set(canvas, context);
  }
  return context;
}

export type InkComparison = {
  readonly inkA: number;
  readonly inkB: number;
  /** Intersection over union of the pixels inked above `threshold`. */
  readonly iou: number;
  readonly meanAbsDiff: number;
  readonly maxAbsDiff: number;
};

/** Compares one premultiplied channel (0 R … 3 alpha) of two equally sized buffers. */
export function compareInk(
  a: Float32Array,
  b: Float32Array,
  channel: number,
  threshold = 0.2,
): InkComparison {
  let inkA = 0;
  let inkB = 0;
  let both = 0;
  let either = 0;
  let sumDiff = 0;
  let maxAbsDiff = 0;
  const pixels = a.length / 4;
  for (let index = 0; index < pixels; index += 1) {
    const va = a[index * 4 + channel] ?? 0;
    const vb = b[index * 4 + channel] ?? 0;
    const inA = va > threshold;
    const inB = vb > threshold;
    if (inA) inkA += 1;
    if (inB) inkB += 1;
    if (inA && inB) both += 1;
    if (inA || inB) either += 1;
    const diff = Math.abs(va - vb);
    sumDiff += diff;
    maxAbsDiff = Math.max(maxAbsDiff, diff);
  }
  return {
    inkA,
    inkB,
    iou: either === 0 ? 1 : both / either,
    meanAbsDiff: sumDiff / pixels,
    maxAbsDiff,
  };
}

/** Source-over of one premultiplied source pixel at `alpha` onto the target. */
function blendPixel(
  target: Float32Array,
  t: number,
  source: Float32Array,
  s: number,
  alpha: number,
): void {
  const sourceAlpha = (source[s + 3] ?? 0) * alpha;
  for (let channel = 0; channel < 4; channel += 1) {
    const value = (source[s + channel] ?? 0) * alpha;
    target[t + channel] = value + (target[t + channel] ?? 0) * (1 - sourceAlpha);
  }
}

function defaultState(): InkState {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    alpha: 1,
    color: [0, 0, 0, 1],
    lineWidth: 1,
    lineCap: 'butt',
  };
}

type CoverageTarget = {
  readonly coverage: Float32Array;
  readonly width: number;
  readonly height: number;
};

type SegmentShape = {
  readonly half: number;
  readonly buttStart: boolean;
  readonly buttEnd: boolean;
};

function rasterizeSegment(
  target: CoverageTarget,
  [x0, y0, x1, y1]: readonly [number, number, number, number],
  shape: SegmentShape,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0 && shape.buttStart && shape.buttEnd) return;
  const reach = shape.half + 1;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - reach));
  const maxX = Math.min(target.width - 1, Math.ceil(Math.max(x0, x1) + reach));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - reach));
  const maxY = Math.min(target.height - 1, Math.ceil(Math.max(y0, y1) + reach));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const value = segmentCoverage(px + 0.5 - x0, py + 0.5 - y0, dx, dy, shape);
      const index = py * target.width + px;
      if (value > (target.coverage[index] ?? 0)) target.coverage[index] = value;
    }
  }
}

// Box-filtered coverage of a pixel centre at (rx, ry) from the segment start:
// a capsule (round cap or join) except across a butt end, which is cut square.
function segmentCoverage(
  rx: number,
  ry: number,
  dx: number,
  dy: number,
  shape: SegmentShape,
): number {
  const length = Math.hypot(dx, dy);
  const t = length === 0 ? 0 : (rx * dx + ry * dy) / (length * length);
  const beforeStart = t < 0 && !shape.buttStart;
  const afterEnd = t > 1 && !shape.buttEnd;
  if (length === 0 || beforeStart || afterEnd) {
    const clamped = Math.max(0, Math.min(1, t));
    return clamp01(shape.half + 0.5 - Math.hypot(rx - clamped * dx, ry - clamped * dy));
  }
  const across = clamp01(shape.half + 0.5 - Math.abs(rx * dy - ry * dx) / length);
  const fromStart = shape.buttStart ? clamp01(0.5 + t * length) : 1;
  const fromEnd = shape.buttEnd ? clamp01(0.5 + (1 - t) * length) : 1;
  return across * Math.min(fromStart, fromEnd);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseColor(value: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex === null) throw new Error(`ink canvas only parses #rrggbb, got ${value}`);
  return [
    parseInt(hex[1] ?? '0', 16) / 255,
    parseInt(hex[2] ?? '0', 16) / 255,
    parseInt(hex[3] ?? '0', 16) / 255,
    1,
  ];
}
