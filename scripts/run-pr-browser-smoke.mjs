import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A pull request's "Chrome UX smoke" runs this focused part of the browser
// suite instead of all of it; pushes to main, merge queue entries and manual
// runs still run the whole suite in shards (ADR-647). The core files cover the
// app shell, the workspace, import and save, text, the machine setup and the
// preview, and take about a tenth of the suite's time. Every spec the pull
// request changed, or whose imported helpers it changed, runs as well, and so
// does every spec that names a changed browser fixture (an HTML page, the
// module it loads, a script or a data file) the import graph cannot see.
export const PR_SMOKE_CORE = [
  'e2e/foundations.spec.ts',
  'e2e/ux-shell.spec.ts',
  'e2e/shared-chrome-layout.spec.ts',
  'e2e/status-bar-layout.spec.ts',
  'e2e/workbench.e2e.ts',
  'e2e/small-document-scenarios.spec.ts',
  'e2e/composed-svg-roundtrip.e2e.ts',
  'e2e/canvas-text-editing.spec.ts',
  'e2e/project-save-worker.e2e.ts',
  'e2e/first-connect-machine-setup.e2e.ts',
  'e2e/gcode-viewer-preview.e2e.ts',
];

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = resolve(workspaceRoot, 'node_modules', '@playwright', 'test', 'cli.js');

// The spec files of a `playwright test --list --reporter=json` report. Each
// top-level suite is one test file, even when its tests come from a fixture
// module the file imports.
export function specFilesOfListing(report) {
  return (report.suites ?? []).map((suite) => `e2e/${suite.file.replaceAll('\\', '/')}`);
}

const SPEC_FILE = /\.(?:e2e|spec)\.ts$/u;
const TEXT_FILE = /\.(?:ts|tsx|js|mjs|cjs|html|json|css)$/u;

// What a file is called where another file loads it: its name without
// extensions (tools-ai-audit.html loads tools-ai-audit.tsx), and the folders
// it sits in below e2e/fixtures/ (data folders are named, not each file).
function namesOf(path) {
  const folders = path
    .split('/')
    .slice(1, -1)
    .filter((folder) => folder !== 'fixtures');
  return [basename(path).replace(/\..*$/u, ''), ...folders].filter((name) => name !== '');
}

// Specs that load a changed non-spec file under e2e/ by name, directly or
// through other files that do. Playwright's --only-changed follows only the
// test process's imports, so a page fixture the browser loads is invisible to
// it. A name found in an unrelated file selects more specs, never fewer.
export function specsNamingChangedFixtures(changedPaths, e2eSources) {
  const pending = changedPaths.filter((path) => path.startsWith('e2e/') && !SPEC_FILE.test(path));
  const seen = new Set(pending);
  const specs = new Set();
  while (pending.length > 0) {
    const names = namesOf(pending.pop());
    for (const [path, source] of e2eSources) {
      if (seen.has(path) || !names.some((name) => source.includes(name))) continue;
      seen.add(path);
      if (SPEC_FILE.test(path)) specs.add(path);
      else pending.push(path);
    }
  }
  return [...specs].sort();
}

function e2eSources(directory = resolve(workspaceRoot, 'e2e')) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return e2eSources(path);
    if (!TEXT_FILE.test(entry.name)) return [];
    return [[relative(workspaceRoot, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')]];
  });
}

function changedE2ePaths(base) {
  const output = execFileSync('git', ['diff', '--name-only', '--no-renames', base, '--', 'e2e'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  return output.split('\n').filter((line) => line !== '');
}

// The core files first, then each changed spec the core does not already hold.
export function selectSpecs(core, changed) {
  return [...new Set([...core, ...changed])];
}

function changedSpecs(base) {
  const captureDirectory = mkdtempSync(resolve(tmpdir(), 'kerfdesk-pr-smoke-'));
  const capturePath = resolve(captureDirectory, 'listing.json');
  let result;
  let listing;
  try {
    const output = openSync(capturePath, 'w');
    try {
      // A regular file avoids pipe buffering and spawnSync's maxBuffer limit.
      result = spawnSync(
        process.execPath,
        [
          playwrightCli,
          'test',
          '--list',
          '--reporter=json',
          `--only-changed=${base}`,
          '--pass-with-no-tests',
        ],
        { cwd: workspaceRoot, encoding: 'utf8', stdio: ['ignore', output, 'pipe'] },
      );
    } finally {
      closeSync(output);
    }
    listing = readFileSync(capturePath, 'utf8');
  } finally {
    rmSync(captureDirectory, { recursive: true, force: true });
  }
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`Playwright could not list the specs changed since ${base}.`);
  }
  return specFilesOfListing(JSON.parse(listing));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = process.argv[2];
  if (!base) {
    process.stderr.write('Usage: node scripts/run-pr-browser-smoke.mjs <base revision>\n');
    process.exit(2);
  }
  const changed = [
    ...changedSpecs(base),
    ...specsNamingChangedFixtures(changedE2ePaths(base), e2eSources()),
  ];
  const specs = selectSpecs(PR_SMOKE_CORE, changed);
  process.stdout.write(
    `Pull request browser smoke: ${PR_SMOKE_CORE.length} core files and ${
      specs.length - PR_SMOKE_CORE.length
    } more changed since ${base}:\n${specs.map((spec) => `- ${spec}`).join('\n')}\n`,
  );
  const run = spawnSync(process.execPath, [playwrightCli, 'test', ...specs], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (run.error !== undefined) throw run.error;
  process.exitCode = run.status ?? 1;
}
