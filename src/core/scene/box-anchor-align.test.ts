import { describe, expect, it } from 'vitest';
import { createRectangle } from '../shapes/primitives';
import { buildBoxAnchorAlign } from './box-anchor-align';
import { IDENTITY_TRANSFORM, type ShapeObject } from './scene-object';

// Reference box: 100 × 80, placed so its bbox is (150,160)-(250,240).
const BOX: ShapeObject = createRectangle({
  id: 'box',
  color: '#ff00aa',
  spec: { widthMm: 100, heightMm: 80, cornerRadiusMm: 0 },
  transform: { ...IDENTITY_TRANSFORM, x: 150, y: 160 },
});

// Artwork: 20 × 10, bbox (0,0)-(20,10) at identity.
const ART: ShapeObject = createRectangle({
  id: 'art',
  color: '#000000',
  spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
});

describe('buildBoxAnchorAlign', () => {
  it('centres artwork on the box', () => {
    const result = buildBoxAnchorAlign([ART, BOX], 'box', 'center');
    expect(result.kind).toBe('ok');
    const t = onlyTransform(result);
    // Box centre (200,200); art centre (10,5) → +190, +195.
    expect(t.x).toBeCloseTo(190, 6);
    expect(t.y).toBeCloseTo(195, 6);
  });

  it('snaps artwork to the bottom-left corner (the origin corner)', () => {
    const result = buildBoxAnchorAlign([ART, BOX], 'box', 'bottom-left');
    const t = onlyTransform(result);
    // left: refMinX(150) - objMinX(0); bottom: refMaxY(240) - objMaxY(10).
    expect(t.x).toBeCloseTo(150, 6);
    expect(t.y).toBeCloseTo(230, 6);
  });

  it('snaps artwork to the top-right corner', () => {
    const result = buildBoxAnchorAlign([ART, BOX], 'box', 'top-right');
    const t = onlyTransform(result);
    // right: refMaxX(250) - objMaxX(20); top: refMinY(160) - objMinY(0).
    expect(t.x).toBeCloseTo(230, 6);
    expect(t.y).toBeCloseTo(160, 6);
  });

  it('snaps artwork to the top-left corner', () => {
    const result = buildBoxAnchorAlign([ART, BOX], 'box', 'top-left');
    const t = onlyTransform(result);
    // left: refMinX(150) - objMinX(0); top: refMinY(160) - objMinY(0).
    expect(t.x).toBeCloseTo(150, 6);
    expect(t.y).toBeCloseTo(160, 6);
  });

  it('snaps artwork to the bottom-right corner', () => {
    const result = buildBoxAnchorAlign([ART, BOX], 'box', 'bottom-right');
    const t = onlyTransform(result);
    // right: refMaxX(250) - objMaxX(20); bottom: refMaxY(240) - objMaxY(10).
    expect(t.x).toBeCloseTo(230, 6);
    expect(t.y).toBeCloseTo(230, 6);
  });

  it('snaps every selected artwork object, excluding the reference box', () => {
    const art2 = createRectangle({
      id: 'art2',
      color: '#000000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 300, y: 300 },
    });
    const result = buildBoxAnchorAlign([ART, art2, BOX], 'box', 'center');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.transforms.map((t) => t.id).sort()).toEqual(['art', 'art2']);
    }
  });

  it('returns ok with no transforms when only the reference box is passed', () => {
    // The one input where the old buildSelectionAlignEdit path returned a
    // 'not-enough-objects' error; the box-anchor path returns ok/[] instead.
    // Both are downstream no-ops, but pin the result kind so it can't drift.
    expect(buildBoxAnchorAlign([BOX], 'box', 'center')).toEqual({ kind: 'ok', transforms: [] });
  });

  it('omits objects already at the anchor (zero delta)', () => {
    const centered = createRectangle({
      id: 'art',
      color: '#000000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 190, y: 195 },
    });
    const result = buildBoxAnchorAlign([centered, BOX], 'box', 'center');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.transforms).toHaveLength(0);
  });

  it('errors on empty selection and missing reference', () => {
    expect(buildBoxAnchorAlign([], 'box', 'center')).toEqual({
      kind: 'error',
      reason: 'empty-selection',
    });
    expect(buildBoxAnchorAlign([ART], 'box', 'center')).toEqual({
      kind: 'error',
      reason: 'missing-reference',
    });
  });
});

function onlyTransform(result: ReturnType<typeof buildBoxAnchorAlign>): {
  readonly x: number;
  readonly y: number;
} {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.reason}`);
  const first = result.transforms[0];
  if (first === undefined) throw new Error('expected one transform');
  return first.transform;
}
