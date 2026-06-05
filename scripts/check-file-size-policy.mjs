import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const MAX_RAW_LINES = 600;
const sourceRoots = ['src'];
const sourceExtensions = new Set(['.ts', '.tsx']);

function* walk(dir) {
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

const oversized = [];
for (const root of sourceRoots) {
  for (const path of walk(root)) {
    const lines = countPhysicalLines(readFileSync(path, 'utf8'));
    if (lines > MAX_RAW_LINES) {
      oversized.push(`${relative(process.cwd(), path)} (${lines} lines)`);
    }
  }
}

if (oversized.length > 0) {
  console.error(`Files exceeding ${MAX_RAW_LINES} raw physical lines:`);
  for (const file of oversized.sort()) {
    console.error(file);
  }
  process.exit(1);
}

console.log(`File-size raw-line backstop passed: ${MAX_RAW_LINES} max physical lines.`);
