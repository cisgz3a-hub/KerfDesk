/**
 * Safe GRBL diagnostics command copyout.
 *
 * The diagnostics helper must never include motion or homing commands. It
 * gives support a small read-only command list the tester can paste into the
 * console and report back.
 *
 * Run: npx tsx tests/grbl-diagnostics-commands.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SAFE_GRBL_DIAGNOSTIC_COMMANDS,
  buildSafeGrblDiagnosticsRequest,
} from '../src/diagnostics/GrblDiagnostics';

const here = dirname(fileURLToPath(import.meta.url));
const consolePanelSrc = readFileSync(resolve(here, '../src/ui/components/ConsolePanel.tsx'), 'utf-8');

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

console.log('\n=== safe GRBL diagnostics commands ===\n');

const commands: string[] = [...SAFE_GRBL_DIAGNOSTIC_COMMANDS];
assert(commands.join('|') === '$I|$$|$G|$#|?', 'diagnostics command order is pinned');
assert(!commands.includes('$H'), 'diagnostics commands do not include homing');
assert(commands.every(cmd => !/^G0|^G1|^M3|^M4|^M5/i.test(cmd)), 'diagnostics commands contain no motion or laser commands');

const request = buildSafeGrblDiagnosticsRequest();
for (const cmd of commands) {
  assert(request.includes(cmd), `diagnostics request includes ${cmd}`);
}
assert(!request.includes('$H'), 'diagnostics request text excludes $H');
assert(/copySafeGrblDiagnostics/.test(consolePanelSrc), 'ConsolePanel exposes diagnostics copy handler');
assert(/buildSafeGrblDiagnosticsRequest/.test(consolePanelSrc), 'ConsolePanel uses diagnostics helper');
assert(/Safe GRBL diagnostics/.test(consolePanelSrc), 'ConsolePanel renders diagnostics copy button');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
