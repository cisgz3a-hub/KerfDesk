import { describe, expect, it } from 'vitest';
import { numbersClose } from './numbers';

describe('numbersClose', () => {
  it('treats exact and sub-epsilon differences as close', () => {
    expect(numbersClose(1000, 1000)).toBe(true);
    expect(numbersClose(1000, 1000.0005)).toBe(true);
    expect(numbersClose(0, 0.0005)).toBe(true);
  });

  it('treats meaningfully different values as not close', () => {
    expect(numbersClose(1000, 255)).toBe(false);
    expect(numbersClose(400, 410)).toBe(false);
    expect(numbersClose(0, 1)).toBe(false);
  });

  it('uses relative tolerance at large magnitudes', () => {
    expect(numbersClose(1_000_000, 1_000_000.5)).toBe(true); // 5e-7 < 0.001
    expect(numbersClose(1_000_000, 1_002_000)).toBe(false); // ~0.002 > 0.001
  });
});
