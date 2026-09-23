import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../core/scene';
import {
  layoutCanvasStartLabels,
  markerLeaderEnd,
  type MarkerBox,
  type StartMarkerLabel,
} from './canvas-motion-marker-layout';

const BOUNDS = { x: 30, y: 30, width: 600, height: 400 };

function labels(frame: Vec2, job: Vec2, height = 24): StartMarkerLabel[] {
  return [
    { kind: 'frame', label: 'Frame start', anchor: frame, width: 112, height },
    { kind: 'job', label: 'Job start', anchor: job, width: 102, height },
  ];
}

function overlaps(a: MarkerBox, b: MarkerBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('start marker label placement', () => {
  it.each([
    {
      name: 'laser laptop',
      bed: { x: 177, y: 166, width: 370, height: 372 },
      artwork: { x: 171, y: 255, width: 115, height: 62 },
    },
    {
      name: 'CNC laptop',
      bed: { x: 218, y: 168, width: 492, height: 491 },
      artwork: { x: 212, y: 285, width: 151, height: 80 },
    },
    {
      name: 'dark coincident',
      bed: { x: 238, y: 166, width: 540, height: 540 },
      artwork: { x: 337, y: 297, width: 165, height: 88 },
    },
  ])(
    'places both names outside the rejected $name artwork and selection outline',
    ({ bed, artwork }) => {
      const anchor = { x: artwork.x, y: artwork.y + artwork.height };
      const obstacle = {
        x: artwork.x - 9,
        y: artwork.y - 9,
        width: artwork.width + 18,
        height: artwork.height + 18,
      };
      const placed = layoutCanvasStartLabels(labels(anchor, anchor), bed, [obstacle]);
      expect(placed).toHaveLength(2);
      for (const marker of placed) {
        expect(overlaps(marker.box, obstacle)).toBe(false);
        expect(marker.anchor).toBe(anchor);
        const end = markerLeaderEnd(anchor, marker.box);
        expect(Math.hypot(end.x - anchor.x, end.y - anchor.y)).toBeLessThan(90);
        expect(marker.box.x).toBeGreaterThanOrEqual(bed.x);
        expect(marker.box.y).toBeGreaterThanOrEqual(bed.y);
        expect(marker.box.x + marker.width).toBeLessThanOrEqual(bed.x + bed.width);
        expect(marker.box.y + marker.height).toBeLessThanOrEqual(bed.y + bed.height);
      }
      expect(overlaps(placed[0]!.box, placed[1]!.box)).toBe(false);
    },
  );

  it('finds free space beyond the artwork when every immediate anchor candidate is covered', () => {
    const anchor = { x: 280, y: 220 };
    const artwork = { x: 100, y: 100, width: 350, height: 240 };
    const placed = layoutCanvasStartLabels(labels(anchor, anchor), BOUNDS, [artwork]);
    expect(placed).toHaveLength(2);
    for (const marker of placed) expect(overlaps(marker.box, artwork)).toBe(false);
    expect(overlaps(placed[0]!.box, placed[1]!.box)).toBe(false);
  });

  it('finds exterior space beyond a dense cluster without treating its empty interior gaps as filled', () => {
    const anchor = { x: 260, y: 260 };
    const dense = Array.from({ length: 100 }, (_, index) => ({
      x: 140 + (index % 10) * 24,
      y: 140 + Math.floor(index / 10) * 24,
      width: 24,
      height: 24,
    }));
    const placed = layoutCanvasStartLabels(labels(anchor, anchor), BOUNDS, dense);
    for (const marker of placed) {
      expect(dense.some((obstacle) => overlaps(marker.box, obstacle))).toBe(false);
    }
    const open = [dense[0]!, dense[dense.length - 1]!];
    const nearby = layoutCanvasStartLabels(labels(anchor, anchor), BOUNDS, open);
    for (const marker of nearby) {
      const end = markerLeaderEnd(anchor, marker.box);
      expect(Math.hypot(end.x - anchor.x, end.y - anchor.y)).toBeLessThan(60);
    }
  });

  it.each([24, 38])(
    'keeps both %ipx-high names readable at coincident and nearby bed-edge anchors',
    (height) => {
      const anchors = [
        { x: 30, y: 30 },
        { x: 630, y: 30 },
        { x: 30, y: 430 },
        { x: 630, y: 430 },
        { x: 300, y: 30 },
        { x: 30, y: 200 },
        { x: 300, y: 200 },
      ];
      for (const frame of anchors) {
        for (const dx of [-20, 0, 1, 20, 90]) {
          const job = { x: Math.max(30, Math.min(630, frame.x + dx)), y: frame.y };
          const input = labels(frame, job, height);
          const placed = layoutCanvasStartLabels(input, BOUNDS);
          expect(placed).toHaveLength(2);
          const [first, second] = placed;
          if (first === undefined || second === undefined) throw new Error('Missing planned start');
          expect(overlaps(first.box, second.box)).toBe(false);
          for (const marker of placed) {
            expect(marker.box.x).toBeGreaterThanOrEqual(BOUNDS.x);
            expect(marker.box.y).toBeGreaterThanOrEqual(BOUNDS.y);
            expect(marker.box.x + marker.box.width).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width);
            expect(marker.box.y + marker.box.height).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.height);
            for (const point of [frame, job]) {
              expect(
                overlaps(marker.box, { x: point.x - 9, y: point.y - 9, width: 18, height: 18 }),
              ).toBe(false);
            }
          }
          expect(first.anchor).toBe(frame);
          expect(second.anchor).toBe(job);
        }
      }
    },
  );

  it('keeps label dimensions constant across zoom while leaders terminate on the exact references', () => {
    for (const scale of [0.25, 1, 6]) {
      const anchor = { x: 30 + 40 * scale, y: 30 + 25 * scale };
      const placed = layoutCanvasStartLabels(labels(anchor, anchor), BOUNDS);
      for (const marker of placed) {
        expect(marker.width).toBe(marker.kind === 'frame' ? 112 : 102);
        expect(marker.height).toBe(24);
        expect(marker.anchor).toBe(anchor);
        const end = markerLeaderEnd(marker.anchor, marker.box);
        const onVerticalEdge = end.x === marker.box.x || end.x === marker.box.x + marker.box.width;
        const onHorizontalEdge =
          end.y === marker.box.y || end.y === marker.box.y + marker.box.height;
        expect(onVerticalEdge || onHorizontalEdge).toBe(true);
      }
    }
  });
});
