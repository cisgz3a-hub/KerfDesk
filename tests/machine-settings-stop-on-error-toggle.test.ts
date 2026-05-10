/**
 * T1-116: regression test for the removed "Stop job on GRBL errors"
 * checkbox. Pre-T1-116 this file pinned the existence of an Advanced
 * section checkbox that let users disable abort-on-error from a
 * casual production UI. T1-116 removed the checkbox — disabling
 * stop-on-error now requires an UnsafeStopOnErrorOverrideToken minted
 * by createStopOnErrorOverrideToken(reason) at the controller layer,
 * which no production code path reaches. This test now asserts the
 * checkbox is GONE so a future refactor doesn't quietly bring it back.
 *
 * Run: npx tsx tests/machine-settings-stop-on-error-toggle.test.ts
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MachineSettingsTab } from '../src/ui/components/settings/MachineSettingsTab';
import { createBlankProfile, type DeviceProfile } from '../src/core/devices/DeviceProfile';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function baseProfile(over: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    ...createBlankProfile('P'),
    bedWidth: 200,
    bedHeight: 200,
    ...over,
  };
}

console.log('\n=== T1-116 MachineSettingsTab: stopOnError checkbox removed ===');

// Default profile: no stop-on-error UI surface.
{
  const html = renderToStaticMarkup(
    React.createElement(MachineSettingsTab, {
      activeProfile: baseProfile(),
      onUpdateProfile: () => {},
      canAutoDetect: false,
      onAutoDetect: () => {},
    }),
  );
  assert(
    !html.includes('Stop job on GRBL errors'),
    'default profile: "Stop job on GRBL errors" label is gone from the production UI',
  );
}

// Even a legacy profile carrying stopOnError=false must not surface a
// re-enable / re-disable control.
{
  const html = renderToStaticMarkup(
    React.createElement(MachineSettingsTab, {
      activeProfile: baseProfile({ stopOnError: false }),
      onUpdateProfile: () => {},
      canAutoDetect: false,
      onAutoDetect: () => {},
    }),
  );
  assert(
    !html.includes('Stop job on GRBL errors'),
    'legacy profile with stopOnError=false: still no UI control surfaced',
  );
}

console.log(`\nT1-116 stopOnError checkbox removal: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
