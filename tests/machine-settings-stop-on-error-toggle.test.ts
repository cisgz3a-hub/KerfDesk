/**
 * Machine settings: Advanced "Stop job on GRBL errors" field renders correctly.
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

console.log('\n=== MachineSettingsTab: Advanced stopOnError field ===');
{
  const html = renderToStaticMarkup(
    React.createElement(MachineSettingsTab, {
      activeProfile: baseProfile(),
      onUpdateProfile: () => {},
      canAutoDetect: false,
      onAutoDetect: () => {},
    }),
  );
  assert(html.includes('Advanced'), 'renders Advanced section');
  assert(html.includes('Stop job on GRBL errors'), 'renders label');
  assert(
    /checked(=\"\")?/i.test(html) || /checked="checked"/i.test(html),
    'default (undefined) shows checked in markup',
  );
}

{
  const html = renderToStaticMarkup(
    React.createElement(MachineSettingsTab, {
      activeProfile: baseProfile({ stopOnError: false }),
      onUpdateProfile: () => {},
      canAutoDetect: false,
      onAutoDetect: () => {},
    }),
  );
  const inAdvanced = html.indexOf('Advanced') < html.indexOf('Stop job on GRBL');
  assert(inAdvanced, 'Advanced title precedes label in DOM order');
  const lastCheckboxBeforeHint = /Stop job on GRBL[\s\S]*?<input[^>]*>/.exec(html);
  const advInp = lastCheckboxBeforeHint
    ? lastCheckboxBeforeHint[0].match(/<input[^>]+>/)?.[0] ?? ''
    : '';
  assert(
    advInp !== '' && !/\bchecked=/.test(advInp),
    'when stopOnError is false, checkbox input has no checked= attribute',
  );
}

console.log(`\nMachine settings stop-on-error toggle: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
