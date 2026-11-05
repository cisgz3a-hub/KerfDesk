/* eslint-disable no-empty-pattern -- Playwright requires a destructured fixture argument, even for these checks that intentionally need no browser fixtures. */
import { expect, test } from '@playwright/test';
import {
  assertOffThreadPhase,
  assertResponsivePhase,
  heartbeatGapCeilingMs,
  recordResponsivenessPhase,
  type ResponsivenessMeasurement,
} from './fixtures/browser-responsiveness';

// Exact preview-readiness telemetry from Chrome run 36085805954. The real
// preview was ready, and this diagnostic phase had no asserted timing budget.
const CI_PREVIEW: ResponsivenessMeasurement = {
  ticks: 10,
  elapsedMs: 1622.1999999999534,
  maxGapMs: 741,
  maxGapLongTaskMs: 733,
  longTaskCount: 3,
  maxLongTaskMs: 733,
  longTaskObserverSupported: true,
};
const RESPONSIVE: ResponsivenessMeasurement = {
  ticks: 100,
  elapsedMs: 1200,
  maxGapMs: 20,
  maxGapLongTaskMs: 0,
  longTaskCount: 0,
  maxLongTaskMs: 0,
  longTaskObserverSupported: true,
};

test('diagnostic telemetry records the reported ten-heartbeat preview without a hidden assertion', ({}, testInfo) => {
  recordResponsivenessPhase(testInfo, 'reported preview readiness', CI_PREVIEW);
  expect(testInfo.annotations).toContainEqual({
    type: 'measurement',
    description:
      'reported preview readiness: elapsedMs=1622.2; ticks=10; maxGapMs=741.0; maxGapLongTaskMs=733.0; longTasks=3; maxLongTaskMs=733.0; longTaskObserver=yes',
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
    assertResponsivePhase(
      testInfo,
      'stalled phase',
      { ...RESPONSIVE, maxGapMs: 1000 },
      heartbeatGapCeilingMs(false),
    ),
  ).toThrow(/maximum heartbeat gap/);
});

// Exact telemetry from main's Browser smoke: run 41962522778 (790b95c4a) and
// run 41900286281 (9372060f7). Both gaps passed on re-run; no page work filled them.
const CI_RUNNER_STALLS: readonly ResponsivenessMeasurement[] = [
  {
    ticks: 430,
    elapsedMs: 7302.6,
    maxGapMs: 1345.03,
    maxGapLongTaskMs: 79,
    longTaskCount: 2,
    maxLongTaskMs: 79,
    longTaskObserverSupported: true,
  },
  {
    ticks: 146,
    elapsedMs: 4443.6,
    maxGapMs: 1592.9,
    maxGapLongTaskMs: 0,
    longTaskCount: 0,
    maxLongTaskMs: 0,
    longTaskObserverSupported: true,
  },
];

test('CI tolerates a runner stall the page did not cause, and local runs do not', ({}, testInfo) => {
  for (const stall of CI_RUNNER_STALLS) {
    assertResponsivePhase(testInfo, 'runner stall', stall, heartbeatGapCeilingMs(true));
    expect(() =>
      assertResponsivePhase(testInfo, 'runner stall', stall, heartbeatGapCeilingMs(false)),
    ).toThrow(/maximum heartbeat gap/);
  }
  expect(testInfo.annotations.filter((note) => note.type === 'warning')).toHaveLength(2);
});

test('CI still rejects a heartbeat gap the page filled with work under the Long Task limit', ({}, testInfo) => {
  // Two back-to-back 600 ms tasks: neither reaches the Long Task limit alone.
  expect(() =>
    assertResponsivePhase(
      testInfo,
      'blocked phase',
      {
        ...RESPONSIVE,
        maxGapMs: 1250,
        maxGapLongTaskMs: 1200,
        longTaskCount: 2,
        maxLongTaskMs: 600,
      },
      heartbeatGapCeilingMs(true),
    ),
  ).toThrow(/Long Task time inside one heartbeat gap/);
});

test('CI still rejects an unattributed heartbeat gap at its ceiling', ({}, testInfo) => {
  expect(() =>
    assertResponsivePhase(
      testInfo,
      'stalled phase',
      { ...RESPONSIVE, maxGapMs: heartbeatGapCeilingMs(true) },
      heartbeatGapCeilingMs(true),
    ),
  ).toThrow(/maximum heartbeat gap/);
});

test('without a Long Task observer the CI tolerance does not apply', ({}, testInfo) => {
  expect(() =>
    assertResponsivePhase(
      testInfo,
      'unobserved stall',
      { ...CI_RUNNER_STALLS[1]!, longTaskObserverSupported: false },
      heartbeatGapCeilingMs(true),
    ),
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
