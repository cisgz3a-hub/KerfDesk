/**
 * T1-9: static guard against scene.canvas dimensions in machine-coordinate code.
 *
 * Run: npx tsx tests/no-scene-canvas-in-machine-coord.test.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const ROOT = process.cwd();
const MACHINE_COORD_DIRS = [
  'src/core',
  'src/app',
  'src/controllers',
  'src/communication',
];
const FORBIDDEN = /\bscene\.canvas\.(width|height)\b/;

function walkTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkTsFiles(full));
    } else if (stat.isFile() && /\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

console.log('\n=== T1-9 no scene.canvas in machine-coordinate paths ===\n');

let totalScanned = 0;
const violations: Array<{ file: string; line: number; excerpt: string }> = [];

for (const relDir of MACHINE_COORD_DIRS) {
  const files = walkTsFiles(resolve(ROOT, relDir));
  totalScanned += files.length;

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const stripped = stripComments(source);
    if (!FORBIDDEN.test(stripped)) continue;

    const sourceLines = source.split(/\r?\n/);
    const strippedLines = stripped.split(/\r?\n/);
    for (let i = 0; i < strippedLines.length; i++) {
      if (FORBIDDEN.test(strippedLines[i] ?? '')) {
        violations.push({
          file: relative(ROOT, file),
          line: i + 1,
          excerpt: (sourceLines[i] ?? '').trim().slice(0, 120),
        });
      }
    }
  }
}

assertContract(
  totalScanned > 0,
  `scanned machine-coordinate files (${totalScanned} files)`,
);

if (violations.length > 0) {
  console.error('\nForbidden scene.canvas dimension references found:');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    ${violation.excerpt}`);
  }
  console.error('\nUse resolveBedWidthMm / resolveBedHeightMm for physical bed dimensions.');
}

assertContract(
  violations.length === 0,
  `no scene.canvas.{width,height} references in ${MACHINE_COORD_DIRS.join(', ')}`,
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
