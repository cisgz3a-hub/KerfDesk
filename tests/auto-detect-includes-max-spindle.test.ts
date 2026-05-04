/**
 * T1-52: Auto-Detect Machine in App.tsx must copy live `$30`
 * (`grblMachineInfo.maxSpindle`) into the active profile, alongside
 * the bed/feed/accel fields it already copies. The previous behavior
 * silently dropped `maxSpindle`, leaving the profile stuck at
 * `createBlankProfile`'s `maxSpindle: 1000` and silently
 * miscalibrating power-scaled output for any non-default controller
 * (`$30=255` is the most common variant).
 *
 * Source-level pin: a behavioral test would need to mount App.tsx
 * with a stubbed grblMachineInfo + spy on updateActiveProfile, both
 * of which are deep in the App's dependency tree. The pin asserts
 * the structural shape so a future refactor cannot silently drop the
 * line again.
 *
 * Run: npx tsx tests/auto-detect-includes-max-spindle.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appPath = resolve(here, '../src/ui/components/App.tsx');
const appSrc = readFileSync(appPath, 'utf-8');

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T1-52 auto-detect-includes-max-spindle ===\n');

// Locate the handleAutoDetectMachine body.
const startIdx = appSrc.indexOf('const handleAutoDetectMachine = useCallback');
assert(startIdx >= 0, 'handleAutoDetectMachine is defined');
const endIdx = appSrc.indexOf('}, [grblMachineInfo, updateActiveProfile]', startIdx);
assert(endIdx > startIdx, 'handleAutoDetectMachine body terminates');
const body = appSrc.slice(startIdx, endIdx);

// 1. updateActiveProfile is called from inside the handler.
assert(
  body.includes('updateActiveProfile({'),
  'handler calls updateActiveProfile with an inline object',
);

// 2. T1-52: maxSpindle is now in the update.
assert(
  /maxSpindle:\s*grblMachineInfo\.maxSpindle\s*>\s*0/.test(body),
  'maxSpindle copies grblMachineInfo.maxSpindle when positive',
);

// 3. Preserves current.maxSpindle when grblMachineInfo.maxSpindle is
//    not positive (null-or-zero). Defensive: a controller without a
//    parsed `$30` shouldn't zero the profile.
assert(
  /maxSpindle[\s\S]*?:\s*current\.maxSpindle/.test(body),
  'falls back to current.maxSpindle when controller value is non-positive',
);

// 4. T1-52 marker present for grep.
assert(
  /T1-52/.test(body),
  'T1-52 marker present in handleAutoDetectMachine for grep discoverability',
);

// 5. Other already-copied fields are still present (no regression on
//    the existing auto-detect contract).
assert(/bedWidth:\s*grblMachineInfo\.bedWidth/.test(body), 'bedWidth still copied (no regression)');
assert(/bedHeight:\s*grblMachineInfo\.bedHeight/.test(body), 'bedHeight still copied (no regression)');
assert(/maxRateX:\s*grblMachineInfo\.maxFeedX/.test(body), 'maxRateX still copied (no regression)');
assert(/maxRateY:\s*grblMachineInfo\.maxFeedY/.test(body), 'maxRateY still copied (no regression)');
assert(/maxAccelX:\s*grblMachineInfo\.maxAccelX/.test(body), 'maxAccelX still copied (no regression)');
assert(/maxAccelY:\s*grblMachineInfo\.maxAccelY/.test(body), 'maxAccelY still copied (no regression)');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
