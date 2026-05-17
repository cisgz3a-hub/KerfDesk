/**
 * T3-58: Machine settings renders verified / profile-only / unknown
 * capability indicators instead of raw safety-critical numbers.
 * Run: npx tsx tests/machine-settings-capability-indicators.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBlankProfile, type DeviceProfile } from '../src/core/devices/DeviceProfile';
import { MachineSettingsTab } from '../src/ui/components/settings/MachineSettingsTab';

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

function profile(over: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    ...createBlankProfile('Capability test'),
    bedWidth: 400,
    bedHeight: 300,
    maxSpindle: 1000,
    homingEnabled: true,
    ...over,
  };
}

function renderMachineSettings(props: Partial<React.ComponentProps<typeof MachineSettingsTab>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(MachineSettingsTab, {
      activeProfile: profile(),
      onUpdateProfile: () => {},
      canAutoDetect: false,
      onAutoDetect: () => {},
      ...props,
    }),
  );
}

console.log('\n=== T3-58 Machine settings capability indicators ===\n');

{
  const html = renderMachineSettings({
    liveCapabilities: {
      bedWidth: 410,
      bedHeight: 305,
      maxSpindle: 255,
      laserMode: true,
      homingEnabled: false,
    },
  });

  assert(html.includes('Capability confidence'), 'renders capability-confidence section');
  assert(html.includes('Bed width') && html.includes('410 mm'), 'bed width uses live firmware value');
  assert(html.includes('Bed height') && html.includes('305 mm'), 'bed height uses live firmware value');
  assert(html.includes('Max spindle') && html.includes('255'), 'max spindle uses live firmware value');
  assert(html.includes('Laser mode') && html.includes('Enabled'), 'laser mode uses live firmware value');
  assert(html.includes('Homing') && html.includes('Disabled'), 'homing uses live firmware value');
  assert((html.match(/Verified/g) ?? []).length >= 5, 'live capabilities are marked Verified');
  assert(html.includes('$130/$131') && html.includes('$30') && html.includes('$32') && html.includes('$22'),
    'indicator details name the GRBL settings they came from');
}

{
  const html = renderMachineSettings();

  assert(html.includes('Profile only'), 'profile-backed values are labelled Profile only');
  assert(html.includes('Connect to verify live controller settings'),
    'manual profile values tell the user to connect for live values');
  assert(html.includes('Laser mode') && html.includes('Unknown'),
    'laser mode is unknown when no live $32 value exists');
  assert(html.includes('Settings not read yet'),
    'unknown values explain that controller settings were not read');
  assert(
    html.includes('Allow manual-zero start when WCS cannot be verified'),
    'settings expose profile WCS compatibility as an explicit machine setting',
  );
}

{
  const html = renderMachineSettings({
    canAutoDetect: true,
  });

  assert(html.includes('max spindle'), 'auto-detect copy includes max spindle');
  assert(html.includes('laser mode') && html.includes('homing'),
    'auto-detect copy includes laser mode and homing state');
}

{
  const root = process.cwd();
  const settingsSource = fs.readFileSync(
    path.join(root, 'src', 'ui', 'components', 'settings', 'MachineSettingsTab.tsx'),
    'utf8',
  );
  const modalSource = fs.readFileSync(
    path.join(root, 'src', 'ui', 'components', 'AppSettingsModal.tsx'),
    'utf8',
  );
  const appSource = fs.readFileSync(
    path.join(root, 'src', 'ui', 'components', 'App.tsx'),
    'utf8',
  );

  assert(settingsSource.includes('T3-58'), 'MachineSettingsTab carries T3-58 marker');
  assert(settingsSource.includes('resolveCapabilityValue'), 'MachineSettingsTab consumes CapabilityValue resolver');
  assert(modalSource.includes('liveCapabilities: props.liveCapabilities'),
    'AppSettingsModal passes live capabilities into MachineSettingsTab');
  assert(appSource.includes('settingsLiveCapabilities'), 'App.tsx derives live settings capabilities for Settings');
}

console.log(`\nMachine settings capability indicators: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
