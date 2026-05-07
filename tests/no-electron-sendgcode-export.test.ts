/**
 * T2-35 static guard against re-adding the unused Electron native serial IPC.
 *
 * The old bridge exposed serial:list/connect/disconnect/send through preload
 * and main-process IPC, parallel to the real Web Serial controller path. T1-27
 * removed serial:send first; T2-35 removes the whole native bridge.
 *
 * Run: npx tsx tests/no-electron-sendgcode-export.test.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
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
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'dist-electron') {
      continue;
    }
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

const PRELOAD_EXPORTS = ['listPorts', 'connectPort', 'disconnectPort', 'sendGcode'];
const SERIAL_IPC_CHANNELS = ['serial:list', 'serial:connect', 'serial:disconnect', 'serial:send'];

console.log('\n=== T2-35 no Electron native serial IPC ===\n');

{
  const src = stripComments(read('electron/preload.ts'));
  for (const name of PRELOAD_EXPORTS) {
    assert(!new RegExp(`\\b${name}\\b`).test(src),
      `electron/preload.ts has no ${name} export outside comments`);
  }
  for (const channel of SERIAL_IPC_CHANNELS) {
    assert(!src.includes(`'${channel}'`) && !src.includes(`"${channel}"`),
      `electron/preload.ts has no ${channel} IPC reference outside comments`);
  }
}

{
  const src = stripComments(read('electron/main.ts'));
  assert(!/from\s+['"]\.\/serial['"]/.test(src),
    'electron/main.ts does not import the removed serial module');
  for (const channel of SERIAL_IPC_CHANNELS) {
    assert(!src.includes(`'${channel}'`) && !src.includes(`"${channel}"`),
      `electron/main.ts has no ${channel} IPC handler outside comments`);
  }
}

{
  const src = stripComments(read('src/types/web-serial.d.ts'));
  for (const name of PRELOAD_EXPORTS) {
    assert(!new RegExp(`\\b${name}\\b`).test(src),
      `src/types/web-serial.d.ts has no ${name} declaration outside comments`);
  }
}

{
  assert(!existsSync(resolve(ROOT, 'electron', 'serial.ts')),
    'electron/serial.ts is deleted');
}

{
  const srcRoot = resolve(ROOT, 'src');
  const hits = walkFiles(srcRoot)
    .filter(file => /\.(ts|tsx|js|jsx|d\.ts)$/.test(file))
    .filter(file => {
      const src = stripComments(readFileSync(file, 'utf-8'));
      return PRELOAD_EXPORTS.some(name => new RegExp(`\\belectronAPI\\.${name}\\b`).test(src));
    })
    .filter(file => basename(file) !== 'web-serial.d.ts');

  assert(hits.length === 0,
    `src/ has no production electronAPI serial bridge references (unexpected hits: ${hits.join(', ') || 'none'})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
