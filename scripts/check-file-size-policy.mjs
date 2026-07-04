import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const MAX_RAW_LINES = 600;
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

const oversized = [];
for (const path of policyTargets()) {
  const lines = countPhysicalLines(readFileSync(path, 'utf8'));
  if (lines > MAX_RAW_LINES) {
    oversized.push(`${relative(process.cwd(), path)} (${lines} lines)`);
  }
}

if (oversized.length > 0) {
  console.error(`Files exceeding ${MAX_RAW_LINES} raw physical lines:`);
  for (const file of oversized.sort()) {
    console.error(file);
  }
  process.exit(1);
}

console.log(
  `File-size raw-line backstop passed: ${MAX_RAW_LINES} max physical lines across source, Electron, scripts, and root configs.`,
);
