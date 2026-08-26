import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const READINESS_LANES = [
  'ci',
  'browser',
  'deploy',
  'packaged-runtime',
  'perceptual-reference-cam',
  'hardware',
];

export function normalizeReadinessState(value) {
  const normalized = String(value ?? 'not-run').toLowerCase();
  if (normalized === 'success') return 'passed';
  if (normalized === 'failure') return 'failed';
  if (normalized === 'cancelled' || normalized === 'skipped') return 'not-run';
  if (['passed', 'failed', 'pending', 'not-run', 'unknown'].includes(normalized)) {
    return normalized;
  }
  throw new Error(`unsupported readiness state: ${value}`);
}

export function buildReadinessReport({ sha, generatedAt, states = {}, evidence = {} }) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`invalid git SHA: ${sha}`);
  return {
    schemaVersion: 1,
    sha,
    generatedAt,
    policy: {
      blocking: false,
      browserGatesDeploy: false,
      note: 'Each lane is independent evidence; an unrun lane remains not-run.',
    },
    lanes: READINESS_LANES.map((id) => ({
      id,
      state: normalizeReadinessState(states[id]),
      evidence: evidence[id] ?? 'No evidence supplied.',
    })),
  };
}

export function readinessMarkdown(report) {
  const rows = report.lanes.map(
    (lane) => `| ${lane.id} | ${lane.state} | ${String(lane.evidence).replaceAll('|', '\\|')} |`,
  );
  return [
    '# Release readiness (informational)',
    '',
    `Commit: \`${report.sha}\``,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Lane | State | Evidence |',
    '|---|---|---|',
    ...rows,
    '',
    'This report is nonblocking. Browser smoke is not a deployment guard, and source/runtime',
    'evidence does not qualify perceptual output, reference-CAM parity, or hardware behavior.',
    '',
  ].join('\n');
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const sha = args.sha ?? process.env['GITHUB_SHA'] ?? (await currentSha());
  const report = buildReadinessReport({
    sha,
    generatedAt: new Date().toISOString(),
    states: args.states,
    evidence: args.evidence,
  });
  const output = resolve(args.output ?? 'artifacts/release-readiness');
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'release-readiness.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(resolve(output, 'release-readiness.md'), readinessMarkdown(report));
  process.stdout.write(`${readinessMarkdown(report)}\n`);
}

function parseArgs(args) {
  const parsed = { states: {}, evidence: {} };
  for (const arg of args) {
    if (arg.startsWith('--sha=')) parsed.sha = arg.slice('--sha='.length);
    else if (arg.startsWith('--output=')) parsed.output = arg.slice('--output='.length);
    else if (arg.startsWith('--state='))
      assignLaneValue(parsed.states, arg.slice('--state='.length));
    else if (arg.startsWith('--evidence=')) {
      assignLaneValue(parsed.evidence, arg.slice('--evidence='.length));
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function assignLaneValue(target, input) {
  const separator = input.indexOf('=');
  const id = input.slice(0, separator);
  if (separator < 1 || !READINESS_LANES.includes(id))
    throw new Error(`invalid lane value: ${input}`);
  target[id] = input.slice(separator + 1);
}

async function currentSha() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  });
  return stdout.trim();
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await runCli().catch((error) => {
    process.stderr.write(`release readiness report failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
