import { describe, expect, it } from 'vitest';
import { sameInputMemo, sameValue } from './same-input-memo';

describe('sameValue', () => {
  it('matches plain data by structure', () => {
    expect(sameValue({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true);
    expect(sameValue([NaN], [NaN])).toBe(true);
  });

  it('tells apart what a JSON key would merge', () => {
    expect(sameValue({ a: undefined }, {})).toBe(false);
    expect(sameValue({ a: NaN }, { a: null })).toBe(false);
    expect(sameValue({ a: 0 }, { a: -0 })).toBe(false);
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(sameValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('compares anything but arrays and plain objects by identity', () => {
    expect(sameValue(new Float64Array([1]), new Float64Array([1]))).toBe(false);
    const map = new Map([[1, 2]]);
    expect(sameValue({ m: map }, { m: map })).toBe(true);
  });
});

describe('sameInputMemo', () => {
  it('computes once for structurally equal arguments and again for new ones', () => {
    let calls = 0;
    const area = sameInputMemo((box: { readonly w: number; readonly h: number }) => {
      calls += 1;
      return { area: box.w * box.h };
    });
    const first = area({ w: 2, h: 3 });
    expect(area({ w: 2, h: 3 })).toBe(first);
    expect(calls).toBe(1);
    expect(area({ w: 2, h: 4 })).toEqual({ area: 8 });
    expect(calls).toBe(2);
  });

  it('keeps only the most recent entries', () => {
    let calls = 0;
    const square = sameInputMemo((value: number) => {
      calls += 1;
      return value * value;
    }, 2);
    square(1);
    square(2);
    square(1); // 1 is now the most recent
    square(3); // drops 2
    expect(calls).toBe(3);
    square(1);
    expect(calls).toBe(3);
    square(2);
    expect(calls).toBe(4);
  });
});
