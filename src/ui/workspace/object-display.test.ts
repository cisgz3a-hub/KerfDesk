import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  sceneLayerVisibility,
  type Layer,
  type Polyline,
  type TracedImage,
} from '../../core/scene';
import { resetArtworkSpritesForTests, SPRITE_MIN_DISPLAY_SEGMENTS } from './artwork-sprite-cache';
import { createDisplayPolylineCache } from './display-polylines';
import {
  ARTWORK_HAIRLINE_WIDTH_PX,
  ARTWORK_STROKE_WIDTH_PX,
  artworkStrokeWidthPx,
  HAIRLINE_STROKE_SEGMENT_THRESHOLD,
  NON_OUTPUT_STROKE_WIDTH_PX,
} from './draw-complexity';
import {
  drawObjectDisplay,
  measureObjectDisplayBounds,
  resolveObjectDisplay,
} from './object-display';

const view = { scale: 2, offsetX: 5, offsetY: 7 };

function square(size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size / 2 },
      { x: 0, y: size / 2 },
      { x: 0, y: 0 },
    ],
  };
}

function zigzag(points: number): Polyline {
  return {
    closed: false,
    points: Array.from({ length: points }, (_, index) => ({ x: index, y: index % 2 })),
  };
}

function traced(polylines: ReadonlyArray<Polyline>, overrides: Partial<TracedImage> = {}) {
  const object: TracedImage = {
    kind: 'traced-image',
    id: 'trace',
    source: 'trace.png',
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
    ...overrides,
  };
  return object;
}

function layers(mode: 'line' | 'fill'): Map<string, Layer> {
  return sceneLayerVisibility.lookup([createLayer({ id: '#000000', color: '#000000', mode })]);
}

// Records the stroke widths and drawing calls the painter issues. Its canvas
// is a plain object, so the sprite path is declined and paint is direct.
function recordingContext() {
  const state: Record<string, unknown> = { canvas: {}, globalAlpha: 1 };
  const widths: number[] = [];
  const calls = { stroke: 0, fill: 0, lineTo: 0, drawImage: 0 };
  const ctx = new Proxy(state, {
    get(target, property) {
      if (property === 'stroke') return () => (calls.stroke += 1);
      if (property === 'fill') return () => (calls.fill += 1);
      if (property === 'lineTo') return () => (calls.lineTo += 1);
      if (property === 'drawImage') return () => (calls.drawImage += 1);
      if (property in target) return target[String(property)];
      return () => undefined;
    },
    set(target, property, value) {
      if (property === 'lineWidth' && typeof value === 'number') widths.push(value);
      target[String(property)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, widths, calls };
}

afterEach(() => {
  resetArtworkSpritesForTests();
  vi.restoreAllMocks();
});

describe('artwork stroke width policy', () => {
  it('keeps the ordinary weight below the hairline threshold and thins dense artwork', () => {
    expect(artworkStrokeWidthPx(HAIRLINE_STROKE_SEGMENT_THRESHOLD - 1, true)).toBe(
      ARTWORK_STROKE_WIDTH_PX,
    );
    expect(artworkStrokeWidthPx(HAIRLINE_STROKE_SEGMENT_THRESHOLD, true)).toBe(
      ARTWORK_HAIRLINE_WIDTH_PX,
    );
    expect(ARTWORK_HAIRLINE_WIDTH_PX).toBeLessThanOrEqual(1);
    expect(artworkStrokeWidthPx(HAIRLINE_STROKE_SEGMENT_THRESHOLD * 10, false)).toBe(
      NON_OUTPUT_STROKE_WIDTH_PX,
    );
  });
});

describe('object display resolution', () => {
  it('resolves fills in design mode and strokes everything in faint mode', () => {
    const object = traced([square(10)]);
    const design = resolveObjectDisplay(object, layers('fill'), view, undefined, 'design');
    expect(design.paths[0]?.paint).toEqual({
      kind: 'fill',
      color: '#000000',
      output: true,
      fillRule: 'evenodd',
    });
    expect(design.displaySegmentCount).toBe(4);
    const faint = resolveObjectDisplay(object, layers('fill'), view, undefined, 'faint');
    expect(faint.paths[0]?.paint).toEqual({ kind: 'stroke', color: '#000000', output: true });
    expect(faint.styleKey).not.toBe(design.styleKey);
  });

  it('skips paths whose operation is hidden and strokes orphan colours as themselves', () => {
    const hidden = sceneLayerVisibility.lookup([
      { ...createLayer({ id: '#000000', color: '#000000' }), visible: false },
    ]);
    expect(
      resolveObjectDisplay(traced([square(10)]), hidden, view, undefined, 'design').paths,
    ).toEqual([]);
    const orphan = resolveObjectDisplay(traced([square(10)]), new Map(), view, undefined, 'design');
    expect(orphan.paths[0]?.paint).toEqual({ kind: 'stroke', color: '#000000', output: true });
  });

  it("measures the display extent under the object's scale and rotation but not its translation", () => {
    const object = traced([square(10)], {
      transform: { ...IDENTITY_TRANSFORM, x: 100, y: 200, scaleX: 2, scaleY: 3, rotationDeg: 90 },
    });
    const resolved = resolveObjectDisplay(object, layers('line'), view, undefined, 'design');
    const bounds = measureObjectDisplayBounds(object, resolved);
    // (10, 5) scaled to (20, 15) then rotated 90° about the origin: x ∈ [-15, 0], y ∈ [0, 20].
    expect(bounds.minX).toBeCloseTo(-15, 9);
    expect(bounds.maxX).toBeCloseTo(0, 9);
    expect(bounds.minY).toBeCloseTo(0, 9);
    expect(bounds.maxY).toBeCloseTo(20, 9);
  });
});

describe('object display painting', () => {
  it('paints sparse artwork directly at the ordinary weight', () => {
    const { ctx, widths, calls } = recordingContext();
    const object = traced([zigzag(50)]);
    const resolved = resolveObjectDisplay(object, layers('line'), view, undefined, 'design');
    drawObjectDisplay(ctx, object, resolved, view);
    expect(widths).toEqual([ARTWORK_STROKE_WIDTH_PX]);
    expect(calls.stroke).toBe(1);
    expect(calls.lineTo).toBe(49);
    expect(calls.drawImage).toBe(0);
  });

  it('paints artwork past the hairline threshold at one device pixel', () => {
    const { ctx, widths } = recordingContext();
    const object = traced([zigzag(HAIRLINE_STROKE_SEGMENT_THRESHOLD + 1)]);
    const resolved = resolveObjectDisplay(object, layers('line'), view, undefined, 'design');
    drawObjectDisplay(ctx, object, resolved, view);
    expect(widths).toEqual([ARTWORK_HAIRLINE_WIDTH_PX]);
  });

  it('blits dense artwork from a sprite on a real canvas and paints it into the sprite once', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const drawImage = vi.fn();
    const mainLineTo = vi.fn();
    const ctx = {
      canvas,
      globalAlpha: 1,
      drawImage,
      lineTo: mainLineTo,
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const spriteContexts: Array<{ lineTo: ReturnType<typeof vi.fn> }> = [];
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return realCreateElement(tag);
      const sprite = { lineTo: vi.fn() };
      spriteContexts.push(sprite);
      return {
        width: 0,
        height: 0,
        getContext: () =>
          new Proxy(sprite, { get: (target, key) => target[key as 'lineTo'] ?? (() => undefined) }),
      } as unknown as HTMLCanvasElement;
    });
    const object = traced([zigzag(SPRITE_MIN_DISPLAY_SEGMENTS + 1)]);
    const cache = createDisplayPolylineCache();
    const resolved = resolveObjectDisplay(object, layers('line'), view, cache, 'design');
    drawObjectDisplay(ctx, object, resolved, view);
    drawObjectDisplay(ctx, object, resolved, { ...view, offsetX: 50 });
    expect(spriteContexts).toHaveLength(1);
    expect(spriteContexts[0]?.lineTo).toHaveBeenCalledTimes(SPRITE_MIN_DISPLAY_SEGMENTS);
    expect(mainLineTo).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledTimes(2);
  });
});
