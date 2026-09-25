/* eslint-disable no-empty-pattern -- Playwright requires a destructured fixture argument, even for these checks that intentionally need no browser fixtures. */
import { expect, test } from '@playwright/test';
import {
  assertOffThreadPhase,
  assertResponsivePhase,
  recordResponsivenessPhase,
  type ResponsivenessMeasurement,
} from './fixtures/browser-responsiveness';

// Exact preview-readiness telemetry from Chrome run 36085805954. The real
// preview was ready, and this diagnostic phase had no asserted timing budget.
const CI_PREVIEW: ResponsivenessMeasurement = {
  ticks: 10,
  elapsedMs: 1622.1999999999534,
  maxGapMs: 741,
  longTaskCount: 3,
  maxLongTaskMs: 733,
  longTaskObserverSupported: true,
};
const RESPONSIVE: ResponsivenessMeasurement = {
  ticks: 100,
  elapsedMs: 1200,
  maxGapMs: 20,
  longTaskCount: 0,
  maxLongTaskMs: 0,
  longTaskObserverSupported: true,
};

test('diagnostic telemetry records the reported ten-heartbeat preview without a hidden assertion', ({}, testInfo) => {
  recordResponsivenessPhase(testInfo, 'reported preview readiness', CI_PREVIEW);
  expect(testInfo.annotations).toContainEqual({
    type: 'measurement',
    description:
      'reported preview readiness: elapsedMs=1622.2; ticks=10; maxGapMs=741.0; longTasks=3; maxLongTaskMs=733.0; longTaskObserver=yes',
  });
});

for (const [name, assertPhase] of [
  ['responsive', assertResponsivePhase],
  ['off-thread', assertOffThreadPhase],
] as const) {
  test(`${name} acceptance still rejects the same ten-heartbeat measurement`, ({}, testInfo) => {
    expect(() => assertPhase(testInfo, 'strict phase', CI_PREVIEW)).toThrow(/heartbeat ticks/);
  });

  test(`${name} acceptance still rejects a main-thread Long Task at the 1000 ms limit`, ({}, testInfo) => {
    expect(() =>
      assertPhase(testInfo, 'blocked phase', {
        ...RESPONSIVE,
        longTaskCount: 1,
        maxLongTaskMs: 1000,
      }),
    ).toThrow(/maximum Long Task/);
  });
}

test('responsive acceptance still rejects a heartbeat gap at the 1000 ms limit', ({}, testInfo) => {
  expect(() =>
    assertResponsivePhase(testInfo, 'stalled phase', { ...RESPONSIVE, maxGapMs: 1000 }),
  ).toThrow(/maximum heartbeat gap/);
});

test('off-thread acceptance still requires an installed Long Task observer', ({}, testInfo) => {
  expect(() =>
    assertOffThreadPhase(testInfo, 'unobserved phase', {
      ...RESPONSIVE,
      longTaskObserverSupported: false,
    }),
  ).toThrow(/Long Task observer/);
});

test('the existing responsive measurement passes both strict acceptance wrappers', ({}, testInfo) => {
  assertResponsivePhase(testInfo, 'responsive phase', RESPONSIVE);
  assertOffThreadPhase(testInfo, 'off-thread phase', RESPONSIVE);
});
