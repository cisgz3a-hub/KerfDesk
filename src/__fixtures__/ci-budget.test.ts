import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ciBudgetMs } from './ci-budget';

const ORIGINAL_CI = process.env.CI;
const ORIGINAL_COVERAGE = process.env.KERFDESK_COVERAGE;

beforeEach(() => {
  delete process.env.KERFDESK_COVERAGE;
});

afterEach(() => {
  if (ORIGINAL_CI === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = ORIGINAL_CI;
  }
  if (ORIGINAL_COVERAGE === undefined) {
    delete process.env.KERFDESK_COVERAGE;
  } else {
    process.env.KERFDESK_COVERAGE = ORIGINAL_COVERAGE;
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

  it('uses an instrumentation allowance during report-only coverage runs', () => {
    delete process.env.CI;
    process.env.KERFDESK_COVERAGE = '1';

    expect(ciBudgetMs(40_000, 240_000)).toBe(480_000);
  });
});
