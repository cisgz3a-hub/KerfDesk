import { describe, expect, it } from 'vitest';
import type { SketchCircle, SketchLine, SketchRectangle } from '../../core/design';
import {
  circleCentreMm,
  circleRadiusMm,
  draftAngleDeg,
  draftLengthMm,
  draftRectMm,
  draftToEntity,
  isDraftTool,
  lineEndMm,
  NO_MODIFIERS,
  type DesignDraft,
  type DraftTool,
} from './design-draft';

const draft = (
  tool: DraftTool,
  anchor: { x: number; y: number },
  pointer: { x: number; y: number },
  modifiers = NO_MODIFIERS,
): DesignDraft => ({ tool, anchorMm: anchor, pointerMm: pointer, modifiers });

describe('lineEndMm', () => {
  it('follows the pointer unconstrained', () => {
    expect(lineEndMm(draft('line', { x: 0, y: 0 }, { x: 37, y: 11 }))).toEqual({ x: 37, y: 11 });
  });

  it('locks to the nearest 45 degrees while preserving length', () => {
    const shift = { constrain: true, fromCentre: false };
    // 10 degrees off horizontal snaps to 0; length must survive.
    const d = draft('line', { x: 0, y: 0 }, { x: 98.48, y: 17.36 }, shift);
    const end = lineEndMm(d);
    expect(end.y).toBeCloseTo(0, 6);
    expect(end.x).toBeCloseTo(100, 1);
    expect(draftLengthMm(d)).toBeCloseTo(100, 1);
  });

  it('snaps a near-diagonal to exactly 45 degrees', () => {
    const shift = { constrain: true, fromCentre: false };
    expect(draftAngleDeg(draft('line', { x: 0, y: 0 }, { x: 50, y: 47 }, shift))).toBeCloseTo(
      45,
      6,
    );
  });

  it('does not divide by zero on a zero-length constrained drag', () => {
    const shift = { constrain: true, fromCentre: false };
    const end = lineEndMm(draft('line', { x: 5, y: 5 }, { x: 5, y: 5 }, shift));
    expect(Number.isFinite(end.x)).toBe(true);
    expect(Number.isFinite(end.y)).toBe(true);
  });
});

describe('draftAngleDeg', () => {
  it('reports 0..360, never negative', () => {
    expect(draftAngleDeg(draft('line', { x: 0, y: 0 }, { x: 1, y: -1 }))).toBeCloseTo(315, 6);
  });
});

describe('draftRectMm', () => {
  it('goes corner to corner in any drag direction', () => {
    expect(draftRectMm(draft('rect', { x: 10, y: 10 }, { x: 30, y: 25 }))).toEqual({
      origin: { x: 10, y: 10 },
      widthMm: 20,
      heightMm: 15,
    });
    expect(draftRectMm(draft('rect', { x: 30, y: 25 }, { x: 10, y: 10 }))).toEqual({
      origin: { x: 10, y: 10 },
      widthMm: 20,
      heightMm: 15,
    });
  });

  it('squares on Shift using the larger extent', () => {
    const shift = { constrain: true, fromCentre: false };
    const rect = draftRectMm(draft('rect', { x: 0, y: 0 }, { x: 40, y: 10 }, shift));
    expect(rect.widthMm).toBe(40);
    expect(rect.heightMm).toBe(40);
  });

  it('draws from the centre on Alt', () => {
    const alt = { constrain: false, fromCentre: true };
    expect(draftRectMm(draft('rect', { x: 50, y: 50 }, { x: 60, y: 55 }, alt))).toEqual({
      origin: { x: 40, y: 45 },
      widthMm: 20,
      heightMm: 10,
    });
  });

  it('produces a centred square with Shift and Alt together', () => {
    const both = { constrain: true, fromCentre: true };
    const rect = draftRectMm(draft('rect', { x: 0, y: 0 }, { x: 30, y: 5 }, both));
    expect(rect).toEqual({ origin: { x: -30, y: -30 }, widthMm: 60, heightMm: 60 });
  });
});

describe('circle drafts', () => {
  it('treats the anchor as the centre by default', () => {
    const d = draft('circle', { x: 10, y: 10 }, { x: 10, y: 40 });
    expect(circleCentreMm(d)).toEqual({ x: 10, y: 10 });
    expect(circleRadiusMm(d)).toBeCloseTo(30, 6);
  });

  it('treats the drag as a diameter on Alt', () => {
    const alt = { constrain: false, fromCentre: true };
    const d = draft('circle', { x: 0, y: 0 }, { x: 40, y: 0 }, alt);
    expect(circleCentreMm(d)).toEqual({ x: 20, y: 0 });
    expect(circleRadiusMm(d)).toBeCloseTo(20, 6);
  });
});

describe('draftToEntity', () => {
  it('builds a line through the constrained endpoint', () => {
    const entity = draftToEntity(draft('line', { x: 0, y: 0 }, { x: 5, y: 0 }), 'e1') as SketchLine;
    expect(entity.kind).toBe('line');
    expect(entity.id).toBe('e1');
    expect(entity.end).toEqual({ x: 5, y: 0 });
  });

  it('builds a sharp-cornered rectangle', () => {
    const entity = draftToEntity(
      draft('rect', { x: 0, y: 0 }, { x: 20, y: 10 }),
      'e2',
    ) as SketchRectangle;
    expect(entity.kind).toBe('rect');
    expect(entity.cornerRadiusMm).toBe(0);
    expect(entity.widthMm).toBe(20);
  });

  it('builds a circle', () => {
    const entity = draftToEntity(
      draft('circle', { x: 1, y: 2 }, { x: 1, y: 12 }),
      'e3',
    ) as SketchCircle;
    expect(entity.kind).toBe('circle');
    expect(entity.radiusMm).toBeCloseTo(10, 6);
  });
});

describe('isDraftTool', () => {
  it('accepts only the drag-drawn tools', () => {
    expect(isDraftTool('line')).toBe(true);
    expect(isDraftTool('rect')).toBe(true);
    expect(isDraftTool('circle')).toBe(true);
    expect(isDraftTool('select')).toBe(false);
    expect(isDraftTool('fillet')).toBe(false);
  });
});
