/**
 * Setup wizard home-corner/profile wiring.
 *
 * Run: npx tsx tests/home-corner-wizard-profile.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inferHomeCornerFromGrblHomingDir } from '../src/core/devices/homeCorner';

const here = dirname(fileURLToPath(import.meta.url));
const profileSrc = readFileSync(resolve(here, '../src/core/devices/DeviceProfile.ts'), 'utf-8');
const wizardSrc = readFileSync(resolve(here, '../src/ui/components/WelcomeWizard.tsx'), 'utf-8');
const wizardHandlersSrc = readFileSync(resolve(here, '../src/ui/hooks/useWizardHandlers.ts'), 'utf-8');
const appProfilesSrc = readFileSync(resolve(here, '../src/ui/hooks/useAppDeviceProfiles.ts'), 'utf-8');
const settingsSrc = readFileSync(resolve(here, '../src/ui/components/settings/MachineSettingsTab.tsx'), 'utf-8');

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

console.log('\n=== setup wizard home-corner/profile wiring ===\n');

assert(inferHomeCornerFromGrblHomingDir(0) === 'rear-right', '$23=0 maps to rear-right homing direction');
assert(inferHomeCornerFromGrblHomingDir(1) === 'rear-left', '$23=1 maps to rear-left homing direction');
assert(inferHomeCornerFromGrblHomingDir(2) === 'front-right', '$23=2 maps to front-right homing direction');
assert(inferHomeCornerFromGrblHomingDir(3) === 'front-left', '$23=3 maps to front-left homing direction');
assert(inferHomeCornerFromGrblHomingDir(-1) === null, 'negative $23 masks are rejected');
assert(inferHomeCornerFromGrblHomingDir(8) === null, 'non-XY $23 masks are rejected for 2D corner inference');

assert(/homeCorner\?:\s*MachineOriginCorner/.test(profileSrc), 'DeviceProfile has optional homeCorner field');
assert(/profile\.homeCorner\s*=\s*p\.homeCorner\s*\?\?\s*profile\.originCorner/.test(profileSrc), 'profile backfill defaults homeCorner to originCorner');
assert(/homeCorner:\s*'front-left'/.test(profileSrc), 'Falcon profile pins homeCorner front-left');
assert(/homeCorner:\s*'rear-right'/.test(profileSrc), 'PRT4040 profile pins homeCorner rear-right');

assert(/homeCorner:\s*MachineOriginCorner/.test(wizardSrc), 'WizardResult includes homeCorner');
assert(/initialHomeCorner\?:\s*MachineOriginCorner/.test(wizardSrc), 'WelcomeWizard accepts initialHomeCorner');
assert(/const \[homeCorner,\s*setHomeCorner\]/.test(wizardSrc), 'WelcomeWizard stores homeCorner state');
assert(/Where is machine zero \(X0 Y0\)\?/.test(wizardSrc), 'wizard uses clear machine-zero wording');
assert(/Where does Home move the laser\?/.test(wizardSrc), 'wizard has a separate Home corner choice');
assert(/setHomeCorner\('same-as-origin'\)/.test(wizardSrc), 'wizard offers same-as-machine-zero Home corner option');
assert(/homeCorner:\s*homeCorner === 'same-as-origin' \? originCorner : homeCorner/.test(wizardSrc), 'wizard completion resolves same-as-origin to originCorner');

assert(/homeCorner:\s*result\.homeCorner/.test(wizardHandlersSrc), 'wizard handler writes homeCorner to existing profiles');
assert(/profile\.homeCorner\s*=\s*result\.homeCorner/.test(wizardHandlersSrc), 'wizard handler writes homeCorner to new profiles');

assert(/homingDir:\s*number/.test(appProfilesSrc), 'auto-detect profile info includes homingDir');
assert(/inferHomeCornerFromGrblHomingDir/.test(appProfilesSrc), 'auto-detect imports GRBL $23 home-corner helper');
assert(/homeCorner:\s*inferHomeCornerFromGrblHomingDir\(grblMachineInfo\.homingDir\)/.test(appProfilesSrc), 'auto-detect copies detected homeCorner from $23');

assert(/Home corner/.test(settingsSrc), 'Machine settings exposes Home corner');
assert(/Machine zero corner/.test(settingsSrc), 'Machine settings exposes machine-zero corner');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
