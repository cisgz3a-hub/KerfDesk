import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { JobBounds } from './job-bounds';
import { describeFramePreflightFailure, framePreflight } from './frame-preflight';

const bed = DEFAULT_DEVICE_PROFILE; // 400 × 400 mm
const okBounds: JobBounds = { minX: 10, minY: 10, maxX: 100, maxY: 80 };

describe('framePreflight', () => {
  it('returns ok when bounds sit fully inside the bed', () => {
    expect(framePreflight(okBounds, bed).kind).toBe('ok');
  });

  it('returns ok when bounds touch the edge exactly (max corners on the bed)', () => {
    // 400×400 design on a 400×400 bed — flush, not over.
    const flush: JobBounds = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
    expect(framePreflight(flush, bed).kind).toBe('ok');
  });

  it('returns ok for a degenerate (single-point) bounds inside the bed', () => {
    const point: JobBounds = { minX: 50, minY: 50, maxX: 50, maxY: 50 };
    expect(framePreflight(point, bed).kind).toBe('ok');
  });

  it('detects overhang on the left side', () => {
    const r = framePreflight({ minX: -5, minY: 10, maxX: 100, maxY: 80 }, bed);
    expect(r.kind).toBe('out-of-bounds');
    if (r.kind === 'out-of-bounds') {
      expect(r.overhang.minX).toBeCloseTo(5);
      expect(r.overhang.maxX).toBe(0);
    }
  });

  it('detects overhang on the right side', () => {
    const r = framePreflight({ minX: 10, minY: 10, maxX: 420, maxY: 80 }, bed);
    expect(r.kind).toBe('out-of-bounds');
    if (r.kind === 'out-of-bounds') {
      expect(r.overhang.maxX).toBeCloseTo(20);
    }
  });

  it('detects overhang on the front side (minY < 0)', () => {
    const r = framePreflight({ minX: 10, minY: -3, maxX: 100, maxY: 80 }, bed);
    expect(r.kind).toBe('out-of-bounds');
    if (r.kind === 'out-of-bounds') {
      expect(r.overhang.minY).toBeCloseTo(3);
    }
  });

  it('detects overhang on the back side (maxY > bedHeight)', () => {
    const r = framePreflight({ minX: 10, minY: 10, maxX: 100, maxY: 500 }, bed);
    expect(r.kind).toBe('out-of-bounds');
    if (r.kind === 'out-of-bounds') {
      expect(r.overhang.maxY).toBeCloseTo(100);
    }
  });

  it('detects overhang on multiple sides simultaneously', () => {
    const r = framePreflight({ minX: -10, minY: -10, maxX: 500, maxY: 500 }, bed);
    expect(r.kind).toBe('out-of-bounds');
    if (r.kind === 'out-of-bounds') {
      expect(r.overhang.minX).toBeCloseTo(10);
      expect(r.overhang.minY).toBeCloseTo(10);
      expect(r.overhang.maxX).toBeCloseTo(100);
      expect(r.overhang.maxY).toBeCloseTo(100);
    }
  });

  it('ignores float-noise overhang below the 1 µm epsilon', () => {
    // maxX exceeds bed by 5e-5 mm — well below stepper resolution and
    // most certainly within float-conversion error.
    const tiny: JobBounds = { minX: 0, minY: 0, maxX: 400.00005, maxY: 400 };
    expect(framePreflight(tiny, bed).kind).toBe('ok');
  });

  it('returns ok for negative bounds inside a center-origin bed', () => {
    const centerBed = { ...bed, origin: 'center' as const };
    const centered: JobBounds = { minX: -150, minY: -120, maxX: 150, maxY: 120 };

    expect(framePreflight(centered, centerBed).kind).toBe('ok');
  });

  it('detects positive overhang beyond a center-origin bed half-width', () => {
    const centerBed = { ...bed, origin: 'center' as const };
    const r = framePreflight({ minX: 0, minY: -20, maxX: 210, maxY: 20 }, centerBed);

    expect(r.kind).toBe('out-of-bounds');
    if (r.kind === 'out-of-bounds') {
      expect(r.overhang.maxX).toBeCloseTo(10);
    }
  });
});

describe('describeFramePreflightFailure', () => {
  it('names the right side and the overhang amount', () => {
    const r = framePreflight({ minX: 10, minY: 10, maxX: 420, maxY: 80 }, bed);
    if (r.kind !== 'out-of-bounds') throw new Error('expected out-of-bounds');
    const msg = describeFramePreflightFailure(r);
    expect(msg).toMatch(/right by 20\.0 mm/);
    expect(msg).toMatch(/400×400 mm/);
  });

  it('lists every overhang side when multiple are over', () => {
    const r = framePreflight({ minX: -5, minY: -8, maxX: 405, maxY: 410 }, bed);
    if (r.kind !== 'out-of-bounds') throw new Error('expected out-of-bounds');
    const msg = describeFramePreflightFailure(r);
    expect(msg).toMatch(/left by 5/);
    expect(msg).toMatch(/right by 5/);
    expect(msg).toMatch(/front by 8/);
    expect(msg).toMatch(/back by 10/);
  });

  it('suggests scaling down or moving the design', () => {
    const r = framePreflight({ minX: -5, minY: 0, maxX: 50, maxY: 50 }, bed);
    if (r.kind !== 'out-of-bounds') throw new Error('expected out-of-bounds');
    expect(describeFramePreflightFailure(r)).toMatch(/scale|move/i);
  });
});
