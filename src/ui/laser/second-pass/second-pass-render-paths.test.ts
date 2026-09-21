import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../../core/scene';
import { secondPassDrawing } from './second-pass-preview';
import { drawSecondPassSegments, visitVisibleSecondPassSegments } from './second-pass-render-paths';

function drawingAt(points: ReadonlyArray<{ x: number; y: number }>) {
  const lines = ['G21', 'G90', 'M4S0'];
  for (const point of points) {
    lines.push(`G0X${point.x}Y${point.y}S0`, `G1X${point.x + 0.125}F1200S250`);
  }
  lines.push('M5');
  return secondPassDrawing(lines.join('\n'), { ...createProject().device, origin: 'rear-left' });
}

class TestPath {
  readonly moves: Array<[number, number]> = [];
  readonly lines: Array<[number, number]> = [];
  moveTo(x: number, y: number): void {
    this.moves.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.lines.push([x, y]);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('indexed second-pass preview paths', () => {
  it('retains full binary64 route data and exact chunk boundaries without a full object route', () => {
    const points = Array.from({ length: 513 }, (_, i) => ({ x: i / 8, y: i < 256 ? 5 : -3 }));
    const drawing = drawingAt(points);
    expect(drawing.segments.length).toBe(513 * 5);
    expect(Array.from(drawing.chunkBounds)).toEqual([
      0, 5, 32, 5, 32, -3, 64, -3, 64, -3, 64.125, -3,
    ]);
    const output: number[] = [];
    visitVisibleSecondPassSegments(
      drawing,
      { x: 7, y: 40, scale: 3 },
      { width: 1000, height: 200 },
      (ax, ay, bx, by, strength) => output.push(ax, ay, bx, by, strength),
    );
    expect(output).toEqual(
      points.flatMap((point) => [point.x, point.y, point.x + 0.125, point.y, 0.25]),
    );
  });

  it('skips offscreen chunks before reading their packed segment coordinates', () => {
    const points = Array.from({ length: 768 }, (_, i) => ({
      x: i < 256 ? 1000 + i : i < 512 ? (i - 256) / 4 : 3000 + i,
      y: 25,
    }));
    const drawing = drawingAt(points);
    let coordinateReads = 0;
    const segments = new Proxy(drawing.segments, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) coordinateReads += 1;
        return Reflect.get(target, key, target) as unknown;
      },
    });
    let visible = 0;
    visitVisibleSecondPassSegments(
      { ...drawing, segments },
      { x: 0, y: 0, scale: 1 },
      { width: 100, height: 50 },
      () => (visible += 1),
    );
    expect(visible).toBe(256);
    expect(coordinateReads).toBe(256 * 5);
  });

  it('includes a thick line whose centre is just outside the viewport', () => {
    const drawing = drawingAt([
      { x: 10, y: -0.03 },
      { x: 10, y: -3 },
    ]);
    const visible: number[] = [];
    visitVisibleSecondPassSegments(
      drawing,
      { x: 0, y: 0, scale: 100 },
      { width: 1500, height: 100 },
      (_ax, ay) => visible.push(ay),
    );
    expect(visible).toEqual([-0.03]);
  });

  it('batches canvas calls in bounded paths while retaining every endpoint and source strength', () => {
    vi.stubGlobal('Path2D', TestPath);
    const points = Array.from({ length: 9000 }, (_, i) => ({
      x: (i % 100) / 8,
      y: Math.floor(i / 100) / 8,
    }));
    const drawing = drawingAt(points);
    const before = drawing.segments.slice();
    const calls: Array<{ alpha: number; path: TestPath }> = [];
    const context = {
      globalAlpha: 1,
      lineWidth: 1,
      lineCap: 'butt',
      strokeStyle: '',
      stroke(path: TestPath) {
        calls.push({ alpha: this.globalAlpha, path });
      },
    };
    drawSecondPassSegments(
      context as unknown as CanvasRenderingContext2D,
      drawing,
      { x: 10, y: 20, scale: 4 },
      { width: 300, height: 300 },
      0.5,
    );
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.path.lines.length <= 4096)).toBe(true);
    expect(calls.map((call) => call.alpha)).toEqual([0.125, 0.125, 0.125]);
    expect(calls.flatMap((call) => call.path.moves)).toEqual(
      points.map((point) => [point.x * 4 + 10, point.y * 4 + 20]),
    );
    expect(calls.flatMap((call) => call.path.lines)).toEqual(
      points.map((point) => [(point.x + 0.125) * 4 + 10, point.y * 4 + 20]),
    );
    expect(drawing.segments).toEqual(before);
    expect(context.globalAlpha).toBe(1);
  });
});
