import { describe, expect, it } from 'vitest';
import { deriveBoxDims, validateBoxSpec, type BoxSpec } from './box-spec';

const BASE: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

describe('deriveBoxDims', () => {
  it('adds twice the thickness per axis in inner mode', () => {
    const dims = deriveBoxDims(BASE);
    expect(dims.outerWidthMm).toBe(66);
    expect(dims.outerDepthMm).toBe(46);
    expect(dims.outerHeightMm).toBe(36);
    expect(dims.innerWidthMm).toBe(60);
  });

  it('subtracts twice the thickness per axis in outer mode', () => {
    const dims = deriveBoxDims({ ...BASE, dimensionMode: 'outer' });
    expect(dims.innerWidthMm).toBe(54);
    expect(dims.innerDepthMm).toBe(34);
    expect(dims.innerHeightMm).toBe(24);
    expect(dims.outerWidthMm).toBe(60);
  });
});

describe('validateBoxSpec', () => {
  it('accepts the canonical spec without warnings', () => {
    expect(validateBoxSpec(BASE)).toEqual({ kind: 'valid', warnings: [] });
  });

  it('rejects non-positive dimensions field by field', () => {
    const result = validateBoxSpec({ ...BASE, widthMm: 0, heightMm: -2 });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues.map((issue) => issue.field).sort()).toEqual(['height', 'width']);
  });

  it('rejects NaN thickness', () => {
    const result = validateBoxSpec({ ...BASE, thicknessMm: Number.NaN });
    expect(result.kind).toBe('invalid');
  });

  it('rejects an outer spec whose walls leave no interior', () => {
    const result = validateBoxSpec({
      ...BASE,
      dimensionMode: 'outer',
      heightMm: 6,
      thicknessMm: 3,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues[0]?.field).toBe('height');
    expect(result.issues[0]?.message).toContain('thickness');
  });

  it('rejects a relief tool as wide as the smallest finger cell', () => {
    // z axis: interior 30, target 9 → 3 cells of 10 mm — the smallest cell.
    const result = validateBoxSpec({
      ...BASE,
      relief: { kind: 'corner-overcut', toolDiameterMm: 10 },
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues[0]?.field).toBe('reliefTool');
    expect(result.issues[0]?.message).toContain('relief tool');
  });

  it('warns when the smallest finger is under twice the relief tool', () => {
    const result = validateBoxSpec({
      ...BASE,
      relief: { kind: 'corner-overcut', toolDiameterMm: 6 },
    });
    expect(result.kind).toBe('valid');
    if (result.kind !== 'valid') return;
    expect(result.warnings[0]?.field).toBe('reliefTool');
  });

  it('accepts a comfortably small relief tool without warnings', () => {
    const result = validateBoxSpec({
      ...BASE,
      relief: { kind: 'corner-overcut', toolDiameterMm: 3.175 },
    });
    expect(result).toEqual({ kind: 'valid', warnings: [] });
  });

  it('rejects clearance that swallows half the joint', () => {
    const result = validateBoxSpec({ ...BASE, clearanceMm: 1.5 });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues[0]?.field).toBe('clearance');
  });

  it('accepts a negative press-fit clearance inside the limit', () => {
    expect(validateBoxSpec({ ...BASE, clearanceMm: -0.1 }).kind).toBe('valid');
  });

  it('rejects negative part spacing', () => {
    const result = validateBoxSpec({ ...BASE, partSpacingMm: -1 });
    expect(result.kind).toBe('invalid');
  });
});
