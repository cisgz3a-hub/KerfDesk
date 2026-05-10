/**
 * T3-46: pin the split-profile schema (Device / Controller / Transport
 * / Output sections), the migration adapter `splitFromMonolithic`,
 * and the validator `validateSplitProfile`.
 *
 * Run: npx tsx tests/profile-schema-validation.test.ts
 */

import {
  createBlankProfile,
  createFalconWiFiProfile,
  createFalconSerialProfile,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import {
  isFalconWifiProfile,
  isSerialGrblProfile,
  splitFromMonolithic,
  validateSplitProfile,
  type SplitDeviceProfile,
  type SplitProfileValidationCode,
} from '../src/core/devices/SplitDeviceProfile';

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

function hasCode(
  result: ReturnType<typeof validateSplitProfile>,
  code: SplitProfileValidationCode,
): boolean {
  return result.issues.some((i) => i.code === code);
}

console.log('\n=== T3-46 split-profile schema validation ===\n');

void (async () => {
  // 1. Migration: a blank serial GRBL profile groups into the four
  //    sections without losing the identity / geometry / controller /
  //    output fields.
  {
    const blank = createBlankProfile('Test profile');
    const split = splitFromMonolithic(blank);

    assert(split.id === blank.id, 'Migration: id preserved');
    assert(split.name === 'Test profile', 'Migration: name preserved');
    assert(split.createdAt === blank.createdAt, 'Migration: createdAt preserved');

    assert(split.device.bedWidth === blank.bedWidth, 'Migration: bedWidth in device section');
    assert(split.device.bedHeight === blank.bedHeight, 'Migration: bedHeight in device section');
    assert(split.device.originCorner === blank.originCorner, 'Migration: originCorner in device section');
    assert(split.device.maxFeedRate === blank.maxFeedRate, 'Migration: maxFeedRate in device section');

    assert(split.controller.family === 'grbl', 'Migration: serial profile -> controller.family grbl');
    assert(split.controller.maxSpindle === blank.maxSpindle, 'Migration: maxSpindle in controller section');
    assert(split.controller.homingEnabled === blank.homingEnabled, 'Migration: homingEnabled in controller section');
    assert(split.controller.softLimitsEnabled === blank.softLimitsEnabled, 'Migration: softLimitsEnabled in controller section');

    assert(split.transport.kind === 'serial', 'Migration: blank profile -> transport.kind serial');
    assert(split.transport.serial?.baudRate === blank.baudRate, 'Migration: baudRate in transport.serial');
    assert(split.transport.falconWifi === undefined, 'Migration: serial profile has no falconWifi block');

    assert(split.output.format === 'grbl', 'Migration: default output.format grbl');
    assert(
      split.output.startGcode === blank.startGcode,
      'Migration: startGcode in output section',
    );
    assert(
      split.output.endGcode === blank.endGcode,
      'Migration: endGcode in output section',
    );
  }

  // 2. Migration: a Falcon WiFi profile groups its connection
  //    metadata into transport.falconWifi and lifts the controller
  //    family to file-upload.
  {
    const wifi = createFalconWiFiProfile('Falcon LAN', '192.168.1.55');
    const split = splitFromMonolithic(wifi);

    assert(split.transport.kind === 'falcon-wifi', 'Migration: falcon-wifi transport.kind');
    assert(
      split.transport.falconWifi?.ip === '192.168.1.55',
      'Migration: ip in transport.falconWifi',
    );
    assert(
      split.transport.serial === undefined,
      'Migration: falcon-wifi profile has no serial transport block',
    );
    assert(
      split.controller.family === 'file-upload',
      'Migration: falcon-wifi profile -> controller.family file-upload',
    );
  }

  // 3. Migration: a serial Falcon profile (USB GRBL) stays in serial
  //    transport with grbl controller family.
  {
    const serialFalcon = createFalconSerialProfile('Falcon USB');
    const split = splitFromMonolithic(serialFalcon);

    assert(split.transport.kind === 'serial', 'Migration: serial Falcon stays serial');
    assert(split.controller.family === 'grbl', 'Migration: serial Falcon stays grbl');
    assert(split.transport.serial !== undefined, 'Migration: serial Falcon has serial block');
  }

  // 4. Validation: a fresh blank profile is valid.
  {
    const split = splitFromMonolithic(createBlankProfile('Valid profile'));
    const result = validateSplitProfile(split);

    assert(result.ok === true, 'Validation: blank serial GRBL profile is ok');
    assert(result.issues.length === 0, 'Validation: blank profile has no issues');
  }

  // 5. Validation: falcon-wifi transport with grbl line-stream output
  //    is the audit's primary conflict case (rule 1).
  {
    const wifi = createFalconWiFiProfile('Falcon LAN', '192.168.1.55');
    const split = splitFromMonolithic(wifi);
    // splitFromMonolithic defaults output.format to 'grbl'; this is
    // the case the validator should catch.
    const result = validateSplitProfile(split);

    assert(result.ok === false, 'Validation: falcon-wifi + grbl output rejected');
    assert(
      hasCode(result, 'transport-output-mismatch'),
      'Validation: falcon-wifi + grbl emits transport-output-mismatch',
    );
    const issue = result.issues.find((i) => i.code === 'transport-output-mismatch');
    assert(issue?.severity === 'error', 'Validation: transport-output-mismatch is error severity');
    assert(issue?.path === 'output.format', 'Validation: transport-output-mismatch points at output.format');
    assert(
      typeof issue?.message === 'string' && /falcon|wifi/i.test(issue.message),
      'Validation: message names the falcon/wifi side of the conflict',
    );
  }

  // 6. Validation: GRBL controller paired with non-GRBL output dialect
  //    rejected (rule 2).
  {
    const blank = createBlankProfile('GRBL with marlin output');
    const split: SplitDeviceProfile = {
      ...splitFromMonolithic(blank),
      output: {
        format: 'marlin',
      },
    };
    const result = validateSplitProfile(split);

    assert(result.ok === false, 'Validation: grbl + marlin output rejected');
    assert(
      hasCode(result, 'controller-output-mismatch'),
      'Validation: grbl + marlin emits controller-output-mismatch',
    );
  }

  // 7. Validation: GRBL controller + custom output is allowed (custom
  //    is the declared escape hatch in rule 2's allowed set).
  {
    const blank = createBlankProfile('GRBL with custom output');
    const split: SplitDeviceProfile = {
      ...splitFromMonolithic(blank),
      output: { format: 'custom' },
    };
    const result = validateSplitProfile(split);
    assert(result.ok === true, 'Validation: grbl + custom output allowed');
  }

  // 8. Validation: file-upload controller on a serial transport
  //    rejected (rule 3 — file-upload controllers do not stream over
  //    serial).
  {
    const blank = createBlankProfile('Bad combination');
    const split: SplitDeviceProfile = {
      ...splitFromMonolithic(blank),
      controller: {
        ...splitFromMonolithic(blank).controller,
        family: 'file-upload',
      },
    };
    const result = validateSplitProfile(split);

    assert(result.ok === false, 'Validation: serial + file-upload controller rejected');
    assert(
      hasCode(result, 'transport-controller-mismatch'),
      'Validation: serial + file-upload emits transport-controller-mismatch',
    );
  }

  // 9. Validation: bed dimensions must be positive (rule 4).
  {
    const blank = createBlankProfile('Zero bed');
    const split: SplitDeviceProfile = {
      ...splitFromMonolithic(blank),
      device: {
        ...splitFromMonolithic(blank).device,
        bedWidth: 0,
        bedHeight: -10,
      },
    };
    const result = validateSplitProfile(split);

    assert(result.ok === false, 'Validation: zero / negative bed dimensions rejected');
    assert(
      result.issues.filter((i) => i.code === 'invalid-bed-dimensions').length === 2,
      'Validation: both bedWidth and bedHeight produce invalid-bed-dimensions issues',
    );
  }

  // 10. Validation: max feed rate must be positive (rule 5).
  {
    const blank = createBlankProfile('Zero feed rate');
    const split: SplitDeviceProfile = {
      ...splitFromMonolithic(blank),
      device: {
        ...splitFromMonolithic(blank).device,
        maxFeedRate: 0,
      },
    };
    const result = validateSplitProfile(split);

    assert(
      hasCode(result, 'invalid-max-feed-rate'),
      'Validation: zero maxFeedRate emits invalid-max-feed-rate',
    );
  }

  // 11. Validation: falcon-wifi requires an IP (rule 6).
  {
    const wifi = createFalconWiFiProfile('No IP', '192.168.1.50');
    const split: SplitDeviceProfile = {
      ...splitFromMonolithic(wifi),
      transport: {
        kind: 'falcon-wifi',
        falconWifi: { ip: '' },
      },
      output: { format: 'custom' },
    };
    const result = validateSplitProfile(split);

    assert(
      hasCode(result, 'falcon-wifi-missing-ip'),
      'Validation: falcon-wifi without IP emits falcon-wifi-missing-ip',
    );
  }

  // 12. Validation: serial transport requires a positive baud rate
  //     (rule 7).
  {
    const blank = createBlankProfile('Bad baud');
    const split: SplitDeviceProfile = {
      ...splitFromMonolithic(blank),
      transport: {
        kind: 'serial',
        serial: { baudRate: 0 },
      },
    };
    const result = validateSplitProfile(split);

    assert(
      hasCode(result, 'serial-missing-baud-rate'),
      'Validation: serial with zero baud rate emits serial-missing-baud-rate',
    );
  }

  // 13. Predicate: isFalconWifiProfile / isSerialGrblProfile.
  {
    const wifiSplit = splitFromMonolithic(createFalconWiFiProfile('Wifi', '10.0.0.1'));
    const serialBlank = splitFromMonolithic(createBlankProfile('Serial'));

    assert(isFalconWifiProfile(wifiSplit) === true, 'Predicate: falcon-wifi -> isFalconWifiProfile true');
    assert(isFalconWifiProfile(serialBlank) === false, 'Predicate: serial -> isFalconWifiProfile false');

    assert(isSerialGrblProfile(serialBlank) === true, 'Predicate: serial GRBL -> isSerialGrblProfile true');
    assert(isSerialGrblProfile(wifiSplit) === false, 'Predicate: falcon-wifi -> isSerialGrblProfile false');
  }

  // 14. Source pin: SplitDeviceProfile module is additive only.
  //     It must not import from storage, validateProfile, or any
  //     consumer that mutates DeviceProfile, so that future T3-46
  //     follow-up slices can migrate live storage deliberately.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const moduleSrc = fs.readFileSync(
      path.resolve(here, '../src/core/devices/SplitDeviceProfile.ts'),
      'utf-8',
    );

    assert(
      !/from\s+['"][^'"]*\/validateProfile['"]/.test(moduleSrc),
      'Source: SplitDeviceProfile does not import validateProfile (own validator)',
    );
    assert(
      !/from\s+['"][^'"]*\/storage(['"\/])/.test(moduleSrc),
      'Source: SplitDeviceProfile does not import storage (additive-only)',
    );
    assert(
      /T3-46/.test(moduleSrc),
      'Source: T3-46 ticket marker present in module',
    );
    // Type-only imports (verify the legacy DeviceProfile shape comes
    // in via `import type`).
    assert(
      /import\s+type\s+\{[\s\S]*?\bDeviceProfile\b[\s\S]*?\}\s+from\s+['"]\.\/DeviceProfile['"]/.test(moduleSrc),
      'Source: DeviceProfile imported as type-only',
    );
  }

  // 15. Migration round-trip on the legacy profile preserves all four
  //     section paths so future code that reads the split shape is
  //     guaranteed not to drop fields silently.
  {
    const original: DeviceProfile = createBlankProfile('Round trip');
    const split = splitFromMonolithic(original);

    assert(typeof split.device.machineType === 'string', 'Round-trip: device.machineType present');
    assert(typeof split.controller.maxSpindle === 'number', 'Round-trip: controller.maxSpindle present');
    assert(typeof split.transport.kind === 'string', 'Round-trip: transport.kind present');
    assert(typeof split.output.format === 'string', 'Round-trip: output.format present');
  }

  console.log(`\nT3-46 split-profile schema: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
