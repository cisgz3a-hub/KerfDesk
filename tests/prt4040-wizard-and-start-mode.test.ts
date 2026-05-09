/**
 * PRT4040 setup wizard and start-mode wiring.
 *
 * Run: npx tsx tests/prt4040-wizard-and-start-mode.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseWizardWatts } from '../src/ui/hooks/useWizardHandlers';

const here = dirname(fileURLToPath(import.meta.url));
const wizardSrc = readFileSync(resolve(here, '../src/ui/components/WelcomeWizard.tsx'), 'utf-8');
const wizardHandlersSrc = readFileSync(resolve(here, '../src/ui/hooks/useWizardHandlers.ts'), 'utf-8');
const appSrc = readFileSync(resolve(here, '../src/ui/components/App.tsx'), 'utf-8');

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

console.log('\n=== PRT4040 wizard/start-mode wiring ===\n');

assert(/'prt4040-router-laser'/.test(wizardSrc), 'WelcomeWizard machinePresetKey union includes PRT4040');
assert(/name:\s*'PRTCNC PRT4040'/.test(wizardSrc), 'WelcomeWizard exposes a PRT4040 preset card');
assert(/presetKey:\s*'prt4040-router-laser'/.test(wizardSrc), 'PRT4040 preset card carries preset key');
assert(/w:\s*400,\s*h:\s*400/.test(wizardSrc), 'PRT4040 preset uses 400x400 workspace');
assert(/watts:\s*'20-40W'/.test(wizardSrc), 'PRT4040 preset displays a parse-safe 20-40W range');

assert(/createPrt4040RouterLaserProfile/.test(wizardHandlersSrc), 'wizard handlers import/use PRT4040 factory');
assert(/result\.machinePresetKey === 'prt4040-router-laser'/.test(wizardHandlersSrc), 'wizard creates PRT4040 factory profile by key');
assert(/export function parseWizardWatts/.test(wizardHandlersSrc), 'wizard uses a dedicated watts parser');
assert(/match\(\s*\/\\d\+\//.test(wizardHandlersSrc), 'wizard watts parser reads the first numeric token');
assert(!/replace\(\/\\D\/g,\s*''\)/.test(wizardHandlersSrc), 'wizard watts parser does not concatenate slash ranges into 2040');
assert(parseWizardWatts('20/40W') === 20, 'wizard watts parser handles slash ranges as the first watt value');
assert(parseWizardWatts('20-40W') === 20, 'wizard watts parser handles dash ranges as the first watt value');
assert(parseWizardWatts('') === 10, 'wizard watts parser falls back to 10W');

assert(/shouldDefaultStartModeToCurrentForProfile/.test(appSrc), 'App imports/uses PRT4040 start-mode helper');
assert(/setStartMode\('current'\)/.test(appSrc), 'App nudges PRT4040 profiles to current/head mode');
assert(/!shouldDefaultStartModeToCurrentForProfile\(activeProfile\)/.test(appSrc), 'disconnect reset does not force PRT4040 back to bed mode');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
