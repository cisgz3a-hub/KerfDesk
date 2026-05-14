/**
 * T3-55: Falcon autofocus profile-heal must consult live firmware
 * version. Autofocus (`$HZ1`) requires firmware ≥ 1.0.38; older
 * firmware emits `error:20` on the line and the probe never moves.
 * This test pins both the version comparator and the heal behavior
 * across known / unknown / parseable / unparseable inputs.
 *
 * Run: npx tsx tests/falcon-autofocus-firmware-gate.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  FALCON_AUTOFOCUS_MIN_FIRMWARE,
  backfillFalconAutofocus,
  firmwareVersionAtLeast,
  parseFirmwareVersion,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';

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

function falconProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    id: 'fp',
    name: 'Falcon A1 Pro',
    createdAt: '2026-05-10T00:00:00Z',
    updatedAt: '2026-05-10T00:00:00Z',
    machineType: 'diode',
    watts: 20,
    brand: 'Creality',
    model: 'Falcon A1 Pro',
    bedWidth: 400,
    bedHeight: 300,
    originCorner: 'front-left',
    maxFeedRate: 6000,
    maxSpindle: 1000,
    homingEnabled: true,
    softLimitsEnabled: false,
    invertY: false,
    returnToOrigin: true,
    baudRate: 115200,
    startGcode: '',
    endGcode: '',
    autoFocusSupported: false,
    autoFocusCommand: '',
    autoFocusTimeoutMs: 0,
    ...overrides,
  };
}

console.log('\n=== T3-55 Falcon autofocus firmware gate ===\n');

void (async () => {
  // 1. parseFirmwareVersion sanity.
  {
    const v = parseFirmwareVersion('1.0.38');
    assert(v?.major === 1, 'parse: 1.0.38 major');
    assert(v?.minor === 0, 'parse: 1.0.38 minor');
    assert(v?.patch === 38, 'parse: 1.0.38 patch');

    const stock = parseFirmwareVersion('1.1h.20221128');
    assert(stock?.major === 1, 'parse: 1.1h.20221128 major');
    assert(stock?.minor === 1, 'parse: 1.1h.20221128 minor');
    assert(stock !== null && stock.patch > 0 && stock.patch < 1, 'parse: 1.1h.20221128 patch is fractional letter weight');

    const tagged = parseFirmwareVersion('1.0.38:Falcon');
    assert(tagged?.major === 1 && tagged?.minor === 0 && tagged?.patch === 38, 'parse: 1.0.38:Falcon (build tag stripped)');

    const tagged2 = parseFirmwareVersion('1.1h:Wainlux');
    assert(tagged2 !== null && tagged2.major === 1 && tagged2.minor === 1, 'parse: 1.1h:Wainlux (letter + build tag)');

    assert(parseFirmwareVersion('not a version') === null, 'parse: garbage returns null');
    assert(parseFirmwareVersion('') === null, 'parse: empty returns null');
    assert(parseFirmwareVersion('1') === null, 'parse: bare major returns null');
    assert(parseFirmwareVersion('1.0.0') !== null, 'parse: 1.0.0 valid');
  }

  // 2. firmwareVersionAtLeast comparisons.
  {
    assert(firmwareVersionAtLeast('1.0.38', '1.0.38'), 'cmp: 1.0.38 >= 1.0.38');
    assert(firmwareVersionAtLeast('1.0.39', '1.0.38'), 'cmp: 1.0.39 >= 1.0.38');
    assert(firmwareVersionAtLeast('1.1.0', '1.0.38'), 'cmp: 1.1.0 >= 1.0.38');
    assert(firmwareVersionAtLeast('2.0.0', '1.0.38'), 'cmp: 2.0.0 >= 1.0.38');
    assert(firmwareVersionAtLeast('1.0.38:Falcon', '1.0.38'), 'cmp: 1.0.38:Falcon >= 1.0.38 (build tag stripped)');
    assert(!firmwareVersionAtLeast('1.0.37', '1.0.38'), 'cmp: 1.0.37 < 1.0.38');
    assert(!firmwareVersionAtLeast('0.9.99', '1.0.38'), 'cmp: 0.9.99 < 1.0.38');
    assert(firmwareVersionAtLeast('1.1h.20221128', '1.1'), 'cmp: 1.1h.20221128 >= 1.1');
    assert(firmwareVersionAtLeast('1.1h.20221128', '1.0.38'), 'cmp: 1.1h.20221128 >= 1.0.38');
    assert(!firmwareVersionAtLeast('1.0', '1.0.38'), 'cmp: 1.0 < 1.0.38 (missing patch parses to 0)');
    assert(!firmwareVersionAtLeast('garbage', '1.0.38'), 'cmp: unparseable returns false (conservative)');
    assert(!firmwareVersionAtLeast('', '1.0.38'), 'cmp: empty string returns false');
  }

  // 3. backfillFalconAutofocus on non-Falcon: untouched.
  {
    const non = falconProfile({ brand: 'Atomstack', model: 'X20 Pro' });
    const out = backfillFalconAutofocus(non);
    assert(out === non, 'non-Falcon: profile passed through unchanged (===)');
  }

  // 4. backfillFalconAutofocus on Falcon, no firmware version supplied:
  //    optimistic heal (preserves pre-T3-55 behavior).
  {
    const out = backfillFalconAutofocus(falconProfile());
    assert(out.autoFocusSupported === true, 'Falcon, no firmware: autoFocusSupported=true (optimistic)');
    assert(out.autoFocusCommand === '$HZ1', 'Falcon, no firmware: autoFocusCommand=$HZ1');
    assert(out.autoFocusTimeoutMs === 15_000, 'Falcon, no firmware: autoFocusTimeoutMs=15000');
  }

  // 5. backfillFalconAutofocus on Falcon with current firmware: enabled.
  {
    const out = backfillFalconAutofocus(falconProfile(), '1.0.38');
    assert(out.autoFocusSupported === true, 'Falcon, fw 1.0.38: autoFocusSupported=true');
    assert(out.autoFocusCommand === '$HZ1', 'Falcon, fw 1.0.38: autoFocusCommand=$HZ1');

    const out2 = backfillFalconAutofocus(falconProfile(), '1.1h.20221128');
    assert(out2.autoFocusSupported === true, 'Falcon, fw 1.1h: autoFocusSupported=true');

    const out3 = backfillFalconAutofocus(falconProfile(), '1.0.39');
    assert(out3.autoFocusSupported === true, 'Falcon, fw 1.0.39: autoFocusSupported=true');
  }

  // 6. backfillFalconAutofocus on Falcon with old firmware: disabled.
  {
    const old = backfillFalconAutofocus(falconProfile(), '1.0.37');
    assert(old.autoFocusSupported === false, 'Falcon, fw 1.0.37: autoFocusSupported=false');
    assert(old.autoFocusCommand === '', 'Falcon, fw 1.0.37: autoFocusCommand cleared');
    assert(old.autoFocusTimeoutMs === 0, 'Falcon, fw 1.0.37: autoFocusTimeoutMs cleared');

    const ancient = backfillFalconAutofocus(falconProfile(), '0.9.0');
    assert(ancient.autoFocusSupported === false, 'Falcon, fw 0.9.0: autoFocusSupported=false');
  }

  // 7. backfillFalconAutofocus on Falcon with unparseable firmware:
  //    refuse autofocus (conservative — cannot confirm version).
  {
    const garbage = backfillFalconAutofocus(falconProfile(), 'banana');
    assert(garbage.autoFocusSupported === false, 'Falcon, fw garbage: autoFocusSupported=false');
  }

  // 8. backfillFalconAutofocus with null / undefined: optimistic heal.
  {
    const a = backfillFalconAutofocus(falconProfile(), null);
    assert(a.autoFocusSupported === true, 'Falcon, fw null: optimistic (autoFocusSupported=true)');

    const b = backfillFalconAutofocus(falconProfile(), undefined);
    assert(b.autoFocusSupported === true, 'Falcon, fw undefined: optimistic');
  }

  // 9. backfillFalconAutofocus with empty string: optimistic heal.
  {
    const out = backfillFalconAutofocus(falconProfile(), '');
    assert(out.autoFocusSupported === true, 'Falcon, fw "": optimistic');
  }

  // 10. Stale autofocus fields on Falcon get overwritten when version
  //     gates fail (sticky-true regression guard).
  {
    const stalePro = falconProfile({
      autoFocusSupported: true,
      autoFocusCommand: '$HZ1',
      autoFocusTimeoutMs: 15_000,
    });
    const out = backfillFalconAutofocus(stalePro, '1.0.36');
    assert(out.autoFocusSupported === false, 'Stale Falcon: autoFocusSupported=true gets overwritten on old fw');
    assert(out.autoFocusCommand === '', 'Stale Falcon: autoFocusCommand cleared on old fw');
  }

  // 11. The minimum-firmware constant is exported and uses 1.0.38.
  {
    assert(FALCON_AUTOFOCUS_MIN_FIRMWARE === '1.0.38', 'FALCON_AUTOFOCUS_MIN_FIRMWARE === "1.0.38"');
  }

  // 12. Live profile wiring: useAppDeviceProfiles must thread the
  //     connected controller's firmware identity into the heal helper.
  {
    const hookSrc = readFileSync(resolve(process.cwd(), 'src/ui/hooks/useAppDeviceProfiles.ts'), 'utf8');
    assert(/backfillFalconAutofocus/.test(hookSrc),
      'useAppDeviceProfiles imports/calls backfillFalconAutofocus');
    assert(/getDeviceIdentity\?:/.test(hookSrc),
      'ProfileAwareController exposes optional getDeviceIdentity');
    assert(/controller\?\.getDeviceIdentity\?\.\(\)\?\.firmwareVersion/.test(hookSrc),
      'useAppDeviceProfiles reads live firmwareVersion from controller identity');
    assert(/backfillFalconAutofocus\(current,\s*firmwareVersion\)/.test(hookSrc),
      'useAppDeviceProfiles passes live firmwareVersion into backfillFalconAutofocus');
    assert(/autoFocusSupported/.test(hookSrc) && /autoFocusCommand/.test(hookSrc) && /autoFocusTimeoutMs/.test(hookSrc),
      'useAppDeviceProfiles compares/persists the three autofocus fields');
  }

  console.log(`\nT3-55 Falcon autofocus firmware gate: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
