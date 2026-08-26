import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS = ['lines', 'branches', 'functions', 'statements'];

export function buildCoverageTrend(summary, baseline) {
  const current = normalizeTotals(summary?.total, 'coverage summary');
  const previous = normalizeTotals(baseline?.totals, 'coverage baseline');
  return {
    schemaVersion: 1,
    currentSha: process.env['GITHUB_SHA'] ?? 'local-working-tree',
    baselineSha: String(baseline?.sha ?? 'unknown'),
    blocking: false,
    metrics: METRICS.map((id) => ({
      id,
      current: current[id],
      baseline: previous[id],
      deltaPct: rounded(current[id].pct - previous[id].pct),
    })),
  };
}

export function coverageTrendMarkdown(report) {
  return [
    '# Coverage trend (report only)',
    '',
    `Current: \`${report.currentSha}\``,
    '',
    `Baseline: \`${report.baselineSha}\``,
    '',
    '| Metric | Covered / total | Current | Baseline | Delta |',
    '|---|---:|---:|---:|---:|',
    ...report.metrics.map(
      (metric) =>
        `| ${metric.id} | ${metric.current.covered} / ${metric.current.total} | ${metric.current.pct.toFixed(2)}% | ${metric.baseline.pct.toFixed(2)}% | ${signed(metric.deltaPct)} pp |`,
    ),
    '',
    'No threshold is enforced. This scheduled artifact is trend evidence, not a merge or release gate.',
    '',
  ].join('\n');
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const [summary, baseline] = await Promise.all([
    readJson(args.summary ?? 'coverage/coverage-summary.json'),
    readJson(args.baseline ?? 'scripts/coverage-baseline.json'),
  ]);
  const report = buildCoverageTrend(summary, baseline);
  const output = resolve(args.output ?? 'artifacts/coverage-trend');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'coverage-trend.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(output, 'coverage-trend.md'), coverageTrendMarkdown(report));
  process.stdout.write(`${coverageTrendMarkdown(report)}\n`);
}

function normalizeTotals(value, label) {
  if (value === null || typeof value !== 'object') throw new Error(`${label} has no totals`);
  return Object.fromEntries(
    METRICS.map((id) => {
      const metric = value[id];
      if (metric === null || typeof metric !== 'object') throw new Error(`${label} lacks ${id}`);
      const normalized = {
        total: finite(metric.total, `${label}.${id}.total`),
        covered: finite(metric.covered, `${label}.${id}.covered`),
        pct: finite(metric.pct, `${label}.${id}.pct`),
      };
      return [id, normalized];
    }),
  );
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function signed(value) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    if (arg.startsWith('--summary=')) parsed.summary = arg.slice('--summary='.length);
    else if (arg.startsWith('--baseline=')) parsed.baseline = arg.slice('--baseline='.length);
    else if (arg.startsWith('--output=')) parsed.output = arg.slice('--output='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await runCli().catch((error) => {
    process.stderr.write(`coverage trend report failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
