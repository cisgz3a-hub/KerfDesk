import { describe, expect, it } from 'vitest';
import { dither } from './dither';
import {
  imageSliceCount,
  sliceDepthOf,
  slicedDepthValue,
  slicePassBurns,
  slicePassValues,
} from './slice-3d';

describe('3D Sliced depth (ADR-699)', () => {
  it('puts white in no slice and black in every slice', () => {
    expect(sliceDepthOf(0, 8)).toBe(0);
    expect(sliceDepthOf(255, 8)).toBe(8);
    expect(sliceDepthOf(128, 4)).toBe(2);
  });

  it('burns each pixel on as many passes as it has slices, darkest first', () => {
    const slices = 4;
    const darkness = [255, 191, 128, 64, 0];
    const burns = darkness.map(() => 0);
    const firstPass = darkness.map(() => -1);
    for (let pass = 0; pass < slices; pass += 1) {
      const values = slicePassValues(darkness, pass, slices, 700);
      values.forEach((value, index) => {
        expect([0, 700]).toContain(value);
        if (value === 0) return;
        burns[index] = (burns[index] ?? 0) + 1;
        if (firstPass[index] === -1) firstPass[index] = pass;
      });
    }
    expect(burns).toEqual([4, 3, 2, 1, 0]);
    // The burned area grows pass by pass: the darkest pixel starts first.
    expect(firstPass).toEqual([0, 1, 2, 3, -1]);
  });

  it('never burns a white pixel, even on extra passes', () => {
    expect(slicePassBurns(0, 300, 4)).toBe(false);
  });

  it('keeps depth proportional with more slices than byte levels', () => {
    expect(imageSliceCount(300)).toBe(300);
    expect(sliceDepthOf(255, 300)).toBe(300);
    expect(imageSliceCount(0)).toBe(1);
    expect(imageSliceCount(Number.NaN)).toBe(1);
  });

  it('previews the whole stack as power proportional to depth', () => {
    expect(slicedDepthValue(255, 4, 1000)).toBe(0);
    expect(slicedDepthValue(0, 4, 1000)).toBe(1000);
    const values = dither(
      { luma: Uint8Array.from([0, 64, 128, 191, 255]), width: 5, height: 1 },
      { algorithm: '3d-sliced', sMax: 1000, sliceCount: 4 },
    );
    expect(Array.from(values)).toEqual([1000, 750, 500, 250, 0]);
  });
});
