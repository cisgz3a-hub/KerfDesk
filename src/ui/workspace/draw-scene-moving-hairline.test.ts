// S2-P2-1 (performance audit S1): a stroke wider than one device pixel goes
// through the GPU's full stroker at a cost per segment, so 5,000 small Line
// circles at 1.5 px made every pan and zoom frame 5-40 times the budget.
// ADR-346 Amendment 1 decides the hairline from the whole frame while the view
// moves, and keeps the 1.5 px weight on the settled frame. These tests count
// stroked segments by width (no timing).
import { describe, expect, it } from 'vitest';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { SPRITE_MIN_DISPLAY_SEGMENTS } from './artwork-sprite-cache';
import {
  ARTWORK_HAIRLINE_WIDTH_PX,
  ARTWORK_STROKE_WIDTH_PX,
  directSegmentCount,
  MOVING_FRAME_HAIRLINE_SEGMENTS,
  movingFrameDrawsHairlines,
} from './draw-complexity';
import { drawScene } from './draw-scene';

const CANVAS_W = 1440;
const CANVAS_H = 900;
const LINE = '#ff0000';
const FILL = '#000000';

type Recorder = {
  readonly ctx: CanvasRenderingContext2D;
  /** Segments stroked at each width, keyed by the width. */
  readonly segmentsByWidth: Map<number, number>;
};

// Records how many segments every stroke() paints, by its lineWidth.
function recordingContext(): Recorder {
  const segmentsByWidth = new Map<number, number>();
  const state: Record<string, unknown> = {
    canvas: { width: CANVAS_W, height: CANVAS_H },
    lineWidth: 1,
  };
  let pathSegments = 0;
  const ctx = new Proxy(state, {
    get(target, property) {
      if (property === 'beginPath') return () => (pathSegments = 0);
      if (property === 'lineTo') return () => (pathSegments += 1);
      if (property === 'stroke') {
        return () => {
          const width = target.lineWidth as number;
          segmentsByWidth.set(width, (segmentsByWidth.get(width) ?? 0) + pathSegments);
        };
      }
      if (property === 'measureText') return () => ({ width: 10 });
      if (property in target) return target[String(property)];
      return () => undefined;
    },
    set(target, property, value) {
      target[String(property)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, segmentsByWidth };
}

function scene(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, layers: [...layers], objects: [...objects] } };
}

// Line circles of Ø3.7 mm on a grid over the bed, like the audit's line-5000.
function lineCircles(count: number): Project {
  const columns = Math.ceil(Math.sqrt(count));
  const pitch = 380 / columns;
  const objects = Array.from({ length: count }, (_, index) =>
    createEllipse({
      id: `c-${index}`,
      color: LINE,
      spec: { widthMm: 3.7, heightMm: 3.7 },
      transform: {
        ...IDENTITY_TRANSFORM,
        x: (index % columns) * pitch + 2,
        y: Math.floor(index / columns) * pitch + 2,
      },
    }),
  );
  return scene(objects, [createLayer({ id: LINE, color: LINE, mode: 'line' })]);
}

// Fill plates with a window centred on each: every pair is a Fill pool whose
// even-odd region is outlined (the audit's plates scene).
function platePairs(pairs: number): Project {
  const columns = Math.ceil(Math.sqrt(pairs));
  const pitch = 380 / columns;
  const at = (index: number, inset: number) => ({
    ...IDENTITY_TRANSFORM,
    x: (index % columns) * pitch + inset,
    y: Math.floor(index / columns) * pitch + inset,
  });
  const plates = Array.from({ length: pairs }, (_, index) =>
    createRectangle({
      id: `plate-${index}`,
      color: FILL,
      spec: { widthMm: 4, heightMm: 4, cornerRadiusMm: 0 },
      transform: at(index, 0.5),
    }),
  );
  const windows = Array.from({ length: pairs }, (_, index) =>
    createRectangle({
      id: `window-${index}`,
      color: FILL,
      spec: { widthMm: 2, heightMm: 2, cornerRadiusMm: 0 },
      transform: at(index, 1.5),
    }),
  );
  return scene([...plates, ...windows], [createLayer({ id: FILL, color: FILL, mode: 'fill' })]);
}

function draw(project: Project, viewMoving: boolean): Map<number, number> {
  const { ctx, segmentsByWidth } = recordingContext();
  drawScene(ctx, CANVAS_W, CANVAS_H, project, {
    selectedId: null,
    preview: false,
    view: { zoomFactor: 1, panX: 0, panY: 0 },
    viewMoving,
  });
  return segmentsByWidth;
}

// The bed chrome strokes a couple of segments at 1.5 px whatever the scene.
const CHROME_SEGMENTS = 10;

function segmentsWiderThanHairline(segmentsByWidth: ReadonlyMap<number, number>): number {
  let count = 0;
  for (const [width, segments] of segmentsByWidth) {
    if (width > ARTWORK_HAIRLINE_WIDTH_PX) count += segments;
  }
  return count;
}

describe('moving frames stroke busy scenes as hairlines (ADR-346 Amendment 1)', () => {
  it('decides from the frame total of small objects, and only while the view moves', () => {
    const small = (count: number) =>
      Array.from({ length: count }, () => ({ displaySegmentCount: 32 }));
    const busy = MOVING_FRAME_HAIRLINE_SEGMENTS / 32;
    expect(movingFrameDrawsHairlines(small(busy), true)).toBe(true);
    expect(movingFrameDrawsHairlines([...small(busy - 1), undefined], true)).toBe(false);
    expect(movingFrameDrawsHairlines(small(busy * 10), false)).toBe(false);
    // A sprited object is a blit whatever its stroke width: it does not count.
    const sprited = { displaySegmentCount: SPRITE_MIN_DISPLAY_SEGMENTS };
    expect(directSegmentCount(Array.from({ length: 10 }, () => sprited))).toBe(0);
  });

  it('strokes 5,000 Line circles at 1.5 px at rest and none wider than a hairline while moving', () => {
    const project = lineCircles(5000);

    const settled = draw(project, false);
    const moving = draw(project, true);

    // The guard: at rest the artwork keeps its weight (16 segments a circle)...
    const artwork = settled.get(ARTWORK_STROKE_WIDTH_PX) ?? 0;
    expect(artwork).toBeGreaterThanOrEqual(5000 * 16);
    // ...and a moving frame strokes none of it through the full stroker.
    expect(segmentsWiderThanHairline(moving)).toBeLessThan(CHROME_SEGMENTS);
    expect(moving.get(ARTWORK_HAIRLINE_WIDTH_PX) ?? 0).toBeGreaterThanOrEqual(
      artwork - CHROME_SEGMENTS,
    );
  });

  it('keeps the 1.5 px weight on a moving frame of 200 objects', () => {
    const project = lineCircles(200);

    const moving = draw(project, true);

    expect(moving.get(ARTWORK_STROKE_WIDTH_PX) ?? 0).toBeGreaterThanOrEqual(200 * 16);
    expect(moving).toEqual(draw(project, false));
  });

  it('outlines thousands of Fill pools as hairlines only while the view moves', () => {
    const project = platePairs(2500);

    const settled = draw(project, false);
    const moving = draw(project, true);

    expect(settled.get(ARTWORK_STROKE_WIDTH_PX) ?? 0).toBeGreaterThanOrEqual(2500 * 8);
    expect(segmentsWiderThanHairline(moving)).toBeLessThan(CHROME_SEGMENTS);
  });

  it('leaves the compiled G-code byte for byte as it was', () => {
    const project = lineCircles(400);
    const before = emitGcode(project).gcode;

    draw(project, true);
    draw(project, false);

    expect(before.length).toBeGreaterThan(0);
    expect(emitGcode(project).gcode).toBe(before);
  });
});
