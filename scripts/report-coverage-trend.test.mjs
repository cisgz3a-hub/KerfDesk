import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoverageTrend, coverageTrendMarkdown } from './report-coverage-trend.mjs';

const metric = (total, covered, pct) => ({ total, covered, skipped: 0, pct });

test('reports line, branch, function, and statement deltas without a threshold', () => {
  const summary = {
    total: {
      lines: metric(100, 80, 80),
      branches: metric(50, 30, 60),
      functions: metric(25, 20, 80),
      statements: metric(120, 90, 75),
    },
  };
  const baseline = {
    sha: '9209fcb',
    totals: {
      lines: metric(90, 70, 77.78),
      branches: metric(45, 27, 60),
      functions: metric(24, 18, 75),
      statements: metric(110, 80, 72.73),
    },
  };

  const report = buildCoverageTrend(summary, baseline);

  assert.equal(report.blocking, false);
  assert.deepEqual(
    report.metrics.map((entry) => [entry.id, entry.deltaPct]),
    [
      ['lines', 2.22],
      ['branches', 0],
      ['functions', 5],
      ['statements', 2.27],
    ],
  );
  assert.match(coverageTrendMarkdown(report), /No threshold is enforced/);
});

test('rejects incomplete totals', () => {
  assert.throws(() => buildCoverageTrend({ total: {} }, { totals: {} }), /lacks lines/);
});
