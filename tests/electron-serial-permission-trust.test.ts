/**
 * Electron Web Serial permission trust boundary.
 *
 * The main process must not grant Web Serial access just because a request asks
 * for the `serial` permission or a serial device. The requesting frame/window
 * has to pass the same trusted-app URL check as packaged IPC/navigation.
 *
 * Run: npx tsx tests/electron-serial-permission-trust.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const MAIN_PATH = join(REPO_ROOT, 'electron', 'main.ts');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== electron serial permission trust ===\n');

const src = readFileSync(MAIN_PATH, 'utf8');
const codeOnly = src
  .replace(/(^|[\s;])\/\/[^\n]*/g, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// 1. Permission checks must inspect the requesting frame URL, not just the
// permission name.
assert(
  /setPermissionCheckHandler\(\(\s*webContents\s*,\s*permission\s*,\s*_[^,]*,\s*details\s*\)/.test(codeOnly),
  'permission check handler receives webContents and details',
);
assert(
  /permission\s*===\s*['"]serial['"][\s\S]{0,300}isTrustedSerialPermissionRequest\(\s*webContents\s*,\s*details\s*\)/.test(codeOnly),
  'serial permission check is gated by isTrustedSerialPermissionRequest(webContents, details)',
);
assert(
  !/return\s+permission\s*===\s*['"]serial['"]\s*;/.test(codeOnly),
  'serial permission is not unconditionally granted by permission name',
);

// 2. Device permission defaults must not grant every serial device globally.
assert(
  /setDevicePermissionHandler\(\(\s*details\s*\)\s*=>/.test(codeOnly),
  'device permission handler is present',
);
assert(
  /setDevicePermissionHandler\(\(\s*details\s*\)\s*=>\s*\{\s*return\s+isTrustedSerialDevicePermissionRequest\(\s*contents\s*,\s*details\s*\)/.test(codeOnly),
  'serial device permission is routed through isTrustedSerialDevicePermissionRequest(contents, details)',
);
assert(
  /function\s+isTrustedSerialDevicePermissionRequest[\s\S]{0,500}isTrustedElectronUrl\(details\.origin\)/.test(codeOnly),
  'serial device helper checks details.origin with isTrustedElectronUrl',
);
assert(
  /function\s+isTrustedSerialDevicePermissionRequest[\s\S]{0,700}details\.origin\s*===\s*['"]file:\/\/['"][\s\S]{0,120}isTrustedElectronUrl\(webContents\.getURL\(\)\)/.test(codeOnly),
  'serial device helper falls back to trusted WebContents URL for coarse file:// origins',
);
assert(
  !/return\s+details\.deviceType\s*===\s*['"]serial['"]\s*;/.test(codeOnly),
  'serial devices are not unconditionally granted by device type',
);

// 3. The serial port picker must also fail closed for an untrusted window.
const selectStart = codeOnly.indexOf("contents.session.on('select-serial-port'");
assert(selectStart >= 0, 'select-serial-port handler is present');
const selectBlock = codeOnly.slice(selectStart, selectStart + 1200);
assert(
  /if\s*\(\s*!isTrustedElectronUrl\(webContents\.getURL\(\)\)\s*\)/.test(selectBlock),
  'serial port picker checks webContents.getURL() before showing the chooser',
);
assert(
  /callback\(['"]{2}\)/.test(selectBlock),
  'serial port picker cancels untrusted requests with an empty selection',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
