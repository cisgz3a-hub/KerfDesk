/**
 * backfillFalconAutofocus() — unconditional heal for Falcon A1 Pro.
 * Run: npx tsx tests/falcon-autofocus-heal.test.ts
 */

import {
  backfillFalconAutofocus,
  createBlankProfile,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';

let passed = 0;
let failed = 0;

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`      expected: ${String(expected)}`);
    console.error(`      actual:   ${String(actual)}`);
  }
}

function baseFalcon(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    ...createBlankProfile('Falcon test'),
    brand: 'Creality',
    model: 'Falcon A1 Pro',
    ...overrides,
  };
}

function runAll(): void {
  console.log('\n=== falcon-autofocus heal ===\n');

  // 1. Non-Falcon: unchanged
  {
    const p: DeviceProfile = {
      ...createBlankProfile('Ortur'),
      brand: 'Ortur',
      model: 'Laser Master 3',
      autoFocusSupported: false,
    };
    const o = backfillFalconAutofocus(p);
    assertEq(o.autoFocusSupported, false, '1. Non-Falcon — autoFocusSupported=false preserved');
  }

  // 2. Falcon, undefined → true
  {
    const o = backfillFalconAutofocus(baseFalcon());
    assertEq(
      o.autoFocusSupported,
      true,
      '2. Falcon — autoFocusSupported undefined → true',
    );
  }

  // 3. Falcon, false → true
  {
    const o = backfillFalconAutofocus(baseFalcon({ autoFocusSupported: false }));
    assertEq(o.autoFocusSupported, true, '3. Falcon — stale false → true');
  }

  // 4. Empty command → $HZ1
  {
    const o = backfillFalconAutofocus(baseFalcon({ autoFocusCommand: '' }));
    assertEq(o.autoFocusCommand, '$HZ1', "4. Falcon — empty autoFocusCommand → '$HZ1'");
  }

  // 5. Wrong command → $HZ1
  {
    const o = backfillFalconAutofocus(baseFalcon({ autoFocusCommand: '$HZ2' }));
    assertEq(o.autoFocusCommand, '$HZ1', "5. Falcon — wrong command → '$HZ1'");
  }

  // 6. Custom timeout → 15000 (firmware-dictated)
  {
    const o = backfillFalconAutofocus(baseFalcon({ autoFocusTimeoutMs: 5000 }));
    assertEq(o.autoFocusTimeoutMs, 15_000, '6. Falcon — custom timeout → 15_000');
  }

  // 7. Already correct — same values
  {
    const before = baseFalcon({
      autoFocusSupported: true,
      autoFocusCommand: '$HZ1',
      autoFocusTimeoutMs: 15_000,
    });
    const o = backfillFalconAutofocus(before);
    assertEq(o.autoFocusSupported, true, '7. Healed profile — supported still true');
    assertEq(o.autoFocusCommand, '$HZ1', "7. Healed profile — command still '$HZ1'");
    assertEq(o.autoFocusTimeoutMs, 15_000, '7. Healed profile — timeout still 15_000');
  }

  // 8. Case-sensitive brand: 'creality' does not match
  {
    const p = baseFalcon({ brand: 'creality' });
    const o = backfillFalconAutofocus(p);
    assertEq(
      o.autoFocusSupported,
      p.autoFocusSupported,
      "8. brand 'creality' — not Creality, profile unchanged (supported)",
    );
    assertEq(
      o.autoFocusCommand,
      p.autoFocusCommand,
      "8. brand 'creality' — command unchanged",
    );
  }

  // 9. Model contains substring: Creality Falcon A1 Pro v2
  {
    const o = backfillFalconAutofocus(
      baseFalcon({ model: 'Creality Falcon A1 Pro v2' }),
    );
    assertEq(
      o.autoFocusSupported,
      true,
      "9. model 'Creality Falcon A1 Pro v2' — backfill applies",
    );
  }

  console.log(`\nFalcon autofocus heal tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
