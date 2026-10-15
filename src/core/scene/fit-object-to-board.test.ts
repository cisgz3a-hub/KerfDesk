import { describe, expect, it } from 'vitest';
import { createEllipse, createRectangle } from '../shapes/primitives';
import { fitObjectToBoard, fittedArtworkSize } from './fit-object-to-board';
import { transformedBBox } from './hit-test';
import { applyTransform } from './transform';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';

const rect = createRectangle({
  id: 'board',
  color: '#000000',
  spec: { widthMm: 100, heightMm: 60, cornerRadiusMm: 0 },
  transform: { ...IDENTITY_TRANSFORM, x: 20, y: 30 },
});
const circle = createEllipse({
  id: 'round',
  color: '#000000',
  spec: { widthMm: 100, heightMm: 100 },
  transform: IDENTITY_TRANSFORM,
});
const artwork: SceneObject = {
  kind: 'imported-svg',
  id: 'art',
  source: 'art.svg',
  paths: [],
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
};

describe('exact board fitting', () => {
  it('reports the actual diameter of a rotated circular logo after fitting', () => {
    const logo = { ...circle, transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 } };
    const plan = fitObjectToBoard(logo, circle, { mode: 'fit', marginMm: 5 });
    if (plan.kind !== 'ok') throw new Error('expected circular fit');
    expect(fittedArtworkSize(plan.object).width).toBeCloseTo(90);
    expect(fittedArtworkSize(plan.object).height).toBeCloseTo(90);
  });

  it('fits with an explicit millimetre edge clearance and preserves proportions', () => {
    const plan = fitObjectToBoard(artwork, rect, { mode: 'fit', marginMm: 5 });
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.scale).toBeCloseTo(4.5);
    expect(transformedBBox(plan.object)).toEqual({ minX: 25, minY: 37.5, maxX: 115, maxY: 82.5 });
  });

  it('keeps actual size and reports when the chosen margin is exceeded', () => {
    const large = {
      ...artwork,
      transform: { ...IDENTITY_TRANSFORM, scaleX: -8, scaleY: 8, rotationDeg: 20, mirrorY: true },
    };
    const plan = fitObjectToBoard(large, rect, { mode: 'keep-size', marginMm: 5 });
    if (plan.kind !== 'ok') throw new Error('expected placement');
    expect(plan.fits).toBe(false);
    expect(plan.object.transform).toMatchObject({
      scaleX: -8,
      scaleY: 8,
      rotationDeg: 20,
      mirrorY: true,
    });
    const bounds = transformedBBox(plan.object);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(70);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(60);
  });

  it.each([
    { board: rect, marginMm: 30 },
    { board: rect, marginMm: 40 },
    { board: circle, marginMm: 50 },
    { board: circle, marginMm: 60 },
  ])('centres unchanged artwork when margin $marginMm leaves no room', ({ board, marginMm }) => {
    const source = {
      ...artwork,
      transform: {
        ...IDENTITY_TRANSFORM,
        x: -90,
        y: 120,
        scaleX: -3,
        scaleY: 2,
        rotationDeg: 37,
        mirrorY: true,
      },
    };
    const plan = fitObjectToBoard(source, board, { mode: 'keep-size', marginMm });
    if (plan.kind !== 'ok' || !('paths' in plan.object))
      throw new Error('expected keep-size vector placement');
    expect(plan.object.kind).toBe(source.kind);
    expect(plan.scale).toBe(1);
    expect(plan.fits).toBe(false);
    expect(plan.object.transform).toMatchObject({
      scaleX: -3,
      scaleY: 2,
      rotationDeg: 37,
      mirrorY: true,
    });
    expect(plan.object.bounds).toEqual(source.bounds);
    expect(plan.object.paths).toBe(source.paths);
    const before = transformedBBox(source);
    const after = transformedBBox(plan.object);
    const boardBounds = transformedBBox(board);
    expect(after.maxX - after.minX).toBeCloseTo(before.maxX - before.minX);
    expect(after.maxY - after.minY).toBeCloseTo(before.maxY - before.minY);
    expect((after.minX + after.maxX) / 2).toBeCloseTo((boardBounds.minX + boardBounds.maxX) / 2);
    expect((after.minY + after.maxY) / 2).toBeCloseTo((boardBounds.minY + boardBounds.maxY) / 2);
    expect(fitObjectToBoard(source, board, { mode: 'fit', marginMm }).kind).toBe('error');
  });

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid margin %s in both modes', (marginMm) => {
    for (const board of [rect, circle]) {
      for (const mode of ['fit', 'keep-size'] as const) {
        expect(fitObjectToBoard(artwork, board, { mode, marginMm }).kind).toBe('error');
      }
    }
  });

  it('uses the circle diameter for a round shape rather than its inscribed square', () => {
    const plan = fitObjectToBoard(circle, circle, { mode: 'fit', marginMm: 5 });
    if (plan.kind !== 'ok') throw new Error('expected circular fit');
    expect(plan.scale).toBeCloseTo(0.9);
    expect(transformedBBox(plan.object)).toEqual({ minX: 5, minY: 5, maxX: 95, maxY: 95 });
  });

  it('does not enlarge a round board when its outline is rotated', () => {
    const rotated = { ...circle, transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 } };
    const plan = fitObjectToBoard(circle, rotated, { mode: 'fit', marginMm: 5 });
    if (plan.kind !== 'ok') throw new Error('expected circular fit');
    expect(plan.scale).toBeCloseTo(0.9);
  });

  it('uses conservative bounds for legacy ellipse tags with different materialised paths', () => {
    const legacy = { ...circle, paths: rect.paths };
    const plan = fitObjectToBoard(legacy, circle, { mode: 'fit', marginMm: 5 });
    if (plan.kind !== 'ok') throw new Error('expected conservative fit');
    expect(plan.scale).toBeCloseTo(0.9 / Math.SQRT2);
  });

  it('keeps every rotated and mirrored rectangular corner inside the round margin', () => {
    const source = {
      ...artwork,
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 37, scaleX: -3, scaleY: 2, mirrorY: true },
    };
    const plan = fitObjectToBoard(source, circle, { mode: 'fit', marginMm: 7 });
    if (plan.kind !== 'ok') throw new Error('expected circular fit');
    for (const x of [0, 20])
      for (const y of [0, 10]) {
        const p = applyTransform({ x, y }, plan.object.transform);
        expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(43);
      }
    expect(plan.object.transform.rotationDeg).toBe(37);
    expect(plan.object.transform.scaleX / plan.object.transform.scaleY).toBeCloseTo(-1.5);
  });

  it.each([NaN, Infinity, -1, 30, 100])(
    'does not produce geometry for unusable margin %s',
    (marginMm) => {
      expect(fitObjectToBoard(artwork, rect, { mode: 'fit', marginMm }).kind).toBe('error');
    },
  );
});
