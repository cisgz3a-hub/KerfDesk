import { describe, expect, it } from 'vitest';
import { applyLumaAdjustments } from './luma-adjust';

describe('applyLumaAdjustments', () => {
  it('returns the same buffer for neutral adjustments', () => {
    const input = new Uint8Array([0, 128, 255]);
    expect(applyLumaAdjustments(input, {})).toBe(input);
    expect(applyLumaAdjustments(input, { brightness: 0, contrast: 0, gamma: 1 })).toBe(input);
  });

  it('applies brightness, contrast, then gamma without mutating input', () => {
    const input = new Uint8Array([64, 128, 192]);
    const out = applyLumaAdjustments(input, { brightness: 10, contrast: 50, gamma: 2 });

    expect(Array.from(input)).toEqual([64, 128, 192]);
    expect(Array.from(out)).toEqual([135, 206, 255]);
  });

  it('clamps extreme gamma into the safe trace-adjustment range', () => {
    const input = new Uint8Array([128]);
    expect(Array.from(applyLumaAdjustments(input, { gamma: 0 }))).toEqual([0]);
    expect(Array.from(applyLumaAdjustments(input, { gamma: 99 }))).toEqual([222]);
  });
});
