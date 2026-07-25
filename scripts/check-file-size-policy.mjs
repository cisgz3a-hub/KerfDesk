import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const MAX_RAW_LINES = 600;
// ADR-259: test files get a higher RAW backstop. Raw physical lines overstate a
// spec's complexity — case tables, fixtures and the explanatory comments this
// repo asks for all count — while the real discipline, ESLint `max-lines` at 400
// COUNTED code lines (blanks and comments skipped), still applies to tests: the
// test override in eslint.config.mjs turns off `max-lines-per-function`, not
// `max-lines`. So this relaxes a proxy metric, not the limit that matters.
const TEST_MAX_RAW_LINES = 900;
const testFilePattern = /\.test\.[cm]?[jt]sx?$/;
const checkedRoots = ['src', 'electron', 'scripts', join('audit', 'scripts')];
const checkedRootFiles = [
  'eslint.config.mjs',
  'eslint.electron.config.mjs',
  'vite.config.ts',
  'vitest.config.ts',
];
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      yield path;
    }
  }
}

function countPhysicalLines(text) {
  if (text.length === 0) return 0;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const content = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return content.length === 0 ? 1 : content.split('\n').length;
}

function* policyTargets() {
  for (const root of checkedRoots) {
    yield* walk(root);
  }
  for (const file of checkedRootFiles) {
    if (existsSync(file) && sourceExtensions.has(extname(file))) {
      yield file;
    }
  }
}

function rawLineLimitFor(path) {
  return testFilePattern.test(path) ? TEST_MAX_RAW_LINES : MAX_RAW_LINES;
}

const oversized = [];
for (const path of policyTargets()) {
  const lines = countPhysicalLines(readFileSync(path, 'utf8'));
  const limit = rawLineLimitFor(path);
  if (lines > limit) {
    oversized.push(`${relative(process.cwd(), path)} (${lines} lines, limit ${limit})`);
  }
}

if (oversized.length > 0) {
  console.error('Files exceeding the raw physical line backstop:');
  for (const file of oversized.sort()) {
    console.error(file);
  }
  process.exit(1);
}

console.log(
  `File-size raw-line backstop passed: ${MAX_RAW_LINES} max physical lines (${TEST_MAX_RAW_LINES} for tests) across source, Electron, scripts, and root configs.`,
);
