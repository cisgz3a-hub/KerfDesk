/**
 * T3-9: every Electron IPC handler must verify the sender frame before
 * validating inputs or executing privileged work.
 *
 * Run: npx tsx tests/ipc-attack-surface.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkHandlerCoverage } from '../src/security/TrustedSender';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ok ${m}`);
  } else {
    failed++;
    console.error(`  fail ${m}`);
  }
}

console.log('\n=== T3-9 IPC attack surface ===\n');

const main = readFileSync(resolve(process.cwd(), 'electron/main.ts'), 'utf-8');
const falcon = readFileSync(resolve(process.cwd(), 'electron/falcon-wifi/FalconWiFiService.ts'), 'utf-8');
const security = readFileSync(resolve(process.cwd(), 'electron/security.ts'), 'utf-8');

const mainCoverage = checkHandlerCoverage({
  source: main,
  guardName: 'assertTrustedSender',
  windowLines: 10,
});
const falconCoverage = checkHandlerCoverage({
  source: falcon,
  guardName: 'assertTrustedSender',
  windowLines: 10,
});

assert(main.includes("from './security'"), 'main imports assertTrustedSender wrapper');
assert(falcon.includes("from '../security'"), 'Falcon WiFi IPC imports assertTrustedSender wrapper');
assert(mainCoverage.totalHandlers > 0, `main has IPC handlers (${mainCoverage.totalHandlers})`);
assert(mainCoverage.unguarded.length === 0, `main handlers all guarded (${mainCoverage.guarded}/${mainCoverage.totalHandlers})`);
assert(falconCoverage.totalHandlers > 0, `Falcon service has IPC handlers (${falconCoverage.totalHandlers})`);
assert(falconCoverage.unguarded.length === 0, `Falcon handlers all guarded (${falconCoverage.guarded}/${falconCoverage.totalHandlers})`);
assert(security.includes('export function assertTrustedSender'), 'electron/security exports assertTrustedSender');
assert(security.includes('event.senderFrame'), 'assertTrustedSender reads event.senderFrame');
assert(security.includes('app.isPackaged'), 'assertTrustedSender chooses packaged/dev environment from app.isPackaged');
assert(security.includes('http://localhost:3000/'), 'assertTrustedSender pins the dev origin');
assert(security.includes('new URL'), 'dev origin check parses URLs instead of string prefix matching');
assert(!main.includes('ipcMain.handle(') || main.includes('assertTrustedSender'), 'main has sender guard calls');
assert(!falcon.includes('ipcMain.handle(') || falcon.includes('assertTrustedSender'), 'Falcon has sender guard calls');

if (mainCoverage.unguarded.length > 0) {
  console.error('Unguarded main handlers:', mainCoverage.unguarded);
}
if (falconCoverage.unguarded.length > 0) {
  console.error('Unguarded Falcon handlers:', falconCoverage.unguarded);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
