import { afterEach, describe, expect, it } from 'vitest';
import { ciBudgetMs } from './ci-budget';

const ORIGINAL_CI = process.env.CI;

afterEach(() => {
  if (ORIGINAL_CI === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = ORIGINAL_CI;
  }
});

describe('ciBudgetMs', () => {
  it('uses the tight local budget when CI is unset', () => {
    delete process.env.CI;

    expect(ciBudgetMs(8_000, 15_000)).toBe(8_000);
  });

  it('uses the generous budget when CI carries a non-empty flag', () => {
    process.env.CI = 'true';

    expect(ciBudgetMs(8_000, 15_000)).toBe(15_000);
  });

  it('treats an empty CI value as local — some shells export CI=""', () => {
    process.env.CI = '';

    expect(ciBudgetMs(40_000, 240_000)).toBe(40_000);
  });
});
