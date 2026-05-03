/**
 * T1-27: static guard against re-adding the renderer-to-controller bypass.
 *
 * The removed window.electronAPI.sendGcode route used IPC serial:send to write
 * raw lines to the serial port, skipping the controller safety stack.
 *
 * Run: npx tsx tests/no-electron-sendgcode-export.test.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

console.log('\n=== T1-27 no electron sendGcode export ===\n');

{
  const src = stripComments(read('electron/preload.ts'));
  assert(
    !/\bsendGcode\b/.test(src) && !/['"]serial:send['"]/.test(src),
    'electron/preload.ts has no sendGcode export or serial:send IPC reference outside comments',
  );
}

{
  const src = stripComments(read('electron/main.ts'));
  assert(!/['"]serial:send['"]/.test(src),
    'electron/main.ts has no serial:send IPC handler outside comments');
}

{
  const src = stripComments(read('src/types/web-serial.d.ts'));
  assert(!/\bsendGcode\b/.test(src),
    'src/types/web-serial.d.ts has no sendGcode declaration outside comments');
}

{
  const srcRoot = resolve(ROOT, 'src');
  const hits = walkFiles(srcRoot)
    .filter(file => /\.(ts|tsx|js|jsx|d\.ts)$/.test(file))
    .filter(file => /\bsendGcode\b/.test(stripComments(readFileSync(file, 'utf-8'))))
    .filter(file => !file.endsWith('web-serial.d.ts'));

  assert(hits.length === 0,
    `src/ has no production sendGcode references (unexpected hits: ${hits.join(', ') || 'none'})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
