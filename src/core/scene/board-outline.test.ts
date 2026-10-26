import { describe, expect, it } from 'vitest';
import {
  MAX_BOARD_OUTLINE_POINTS,
  boardOutlineAnchors,
  defaultCaptureOrder,
  largestInscribedRect,
  normalizeBoardOutline,
  pointInPolygon,
  simplifyClosedOutline,
  sizeBoardOutline,
  type Vec2,
} from '.';

const SQUARE: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const L_SHAPE: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 35 },
  { x: 35, y: 35 },
  { x: 35, y: 100 },
  { x: 0, y: 100 },
];

describe('outline cleanup and anchors', () => {
  it('drops closing and consecutive duplicate points', () => {
    expect(
      normalizeBoardOutline([
        ...SQUARE.slice(0, 2),
        { x: 100.001, y: 0.001 },
        ...SQUARE.slice(2),
        SQUARE[0]!,
      ]),
    ).toEqual(SQUARE);
  });

  it.each<{ points: ReadonlyArray<Vec2> }>([
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
        { x: 20, y: 0 },
      ],
    },
    { points: [...SQUARE.slice(0, 3), { x: Number.NaN, y: 1 }] },
    {
      points: Array.from({ length: MAX_BOARD_OUTLINE_POINTS + 1 }, (_, index) => ({
        x: Math.cos(index),
        y: Math.sin(index),
      })),
    },
  ])('rejects invalid outline %#', ({ points }) => {
    expect(normalizeBoardOutline(points)).toBeNull();
  });

  it('simplifies collinear square edge points to four corners', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 50 },
    ];
    expect(simplifyClosedOutline(points, 0.1)).toHaveLength(4);
  });

  it('uses the five convex L-shape corners and excludes its reflex corner', () => {
    expect(boardOutlineAnchors(L_SHAPE)).toEqual([0, 1, 2, 4, 5]);
  });

  it('falls back to extremes for a smooth 64-gon', () => {
    const circle = Array.from({ length: 64 }, (_, index) => ({
      x: 50 + 50 * Math.cos((index * Math.PI * 2) / 64),
      y: 50 + 50 * Math.sin((index * Math.PI * 2) / 64),
    }));
    expect(boardOutlineAnchors(circle).length).toBeGreaterThanOrEqual(2);
  });

  it('captures nearest bottom-left first and farthest anchor second', () => {
    expect(defaultCaptureOrder(L_SHAPE, [0, 1, 2, 4, 5])).toEqual([5, 1]);
  });

  it('sizes the bbox exactly and moves its top-left to zero', () => {
    const sized = sizeBoardOutline(
      SQUARE.map((point) => ({ x: point.x + 20, y: point.y - 10 })),
      80,
      40,
    );
    expect(sized).not.toBeNull();
    expect(sized?.[0]).toEqual({ x: 0, y: 0 });
    expect(sized?.[2]).toEqual({ x: 80, y: 40 });
    expect(sizeBoardOutline(SQUARE, 0, 20)).toBeNull();
  });
});

describe('largestInscribedRect', () => {
  it.each([
    ['rectangle', SQUARE],
    ['L-shape', L_SHAPE],
    [
      'rotated square',
      [
        { x: 50, y: 0 },
        { x: 100, y: 50 },
        { x: 50, y: 100 },
        { x: 0, y: 50 },
      ],
    ],
    [
      'triangle',
      [
        { x: 50, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    ],
  ] as const)('returns a conservative rectangle for a %s', (_name, polygon) => {
    const result = largestInscribedRect(polygon);
    expect(result).not.toBeNull();
    if (result === null) return;
    const points = [
      { x: result.minX, y: result.minY },
      { x: result.maxX, y: result.minY },
      { x: result.maxX, y: result.maxY },
      { x: result.minX, y: result.maxY },
      { x: (result.minX + result.maxX) / 2, y: (result.minY + result.maxY) / 2 },
    ];
    expect(points.every((point) => pointInPolygon(point, polygon))).toBe(true);
  });

  it('keeps a rectangle within two grid cells of the source', () => {
    const result = largestInscribedRect(SQUARE);
    expect(result).not.toBeNull();
    if (result === null) return;
    const cell = 100 / 128;
    expect(result.minX).toBeLessThanOrEqual(cell * 2);
    expect(result.minY).toBeLessThanOrEqual(cell * 2);
    expect(100 - result.maxX).toBeLessThanOrEqual(cell * 2);
    expect(100 - result.maxY).toBeLessThanOrEqual(cell * 2);
  });

  it('handles a maximum-size outline without rescanning every edge per cell', () => {
    const polygon = Array.from({ length: MAX_BOARD_OUTLINE_POINTS }, (_, index) => ({
      x: 100 + 90 * Math.cos((index * Math.PI * 2) / MAX_BOARD_OUTLINE_POINTS),
      y: 100 + 90 * Math.sin((index * Math.PI * 2) / MAX_BOARD_OUTLINE_POINTS),
    }));
    const started = performance.now();
    expect(largestInscribedRect(polygon)).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(250);
  });
});
