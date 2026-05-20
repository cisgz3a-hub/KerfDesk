/**
 * F45-15-001: declining WCS normalization must never persist future silent normalization.
 *
 * Run: npx tsx tests/wcs-consent-suppression-policy.test.ts
 */
import {
  handleWcsConsentForActiveProfile,
  type ProfileAwareController,
  type WcsConsentPayload,
} from '../src/ui/hooks/useAppDeviceProfiles';
import type { DeviceProfile } from '../src/core/devices/DeviceProfile';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function makeProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    id: 'profile-1',
    name: 'Test GRBL',
    firmware: 'grbl',
    bedWidth: 400,
    bedHeight: 400,
    originCorner: 'front-left',
    maxSpindle: 1000,
    units: 'mm',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as DeviceProfile;
}

const payload: WcsConsentPayload = {
  g54: { x: 5, y: 0, z: 0 },
  statusMask: 255,
};

console.log('\n=== WCS consent suppression policy ===\n');

async function main(): Promise<void> {
  {
  let saved: DeviceProfile | null = null;
  let refreshed = 0;
  let applyCalls = 0;
  let skipCalls = 0;
  const controller: ProfileAwareController = {
    applyWcsNormalization: () => { applyCalls++; },
    skipWcsNormalization: () => { skipCalls++; },
  };

  await handleWcsConsentForActiveProfile(payload, {
    controller,
    getActiveProfile: () => makeProfile(),
    saveDeviceProfile: (profile) => { saved = profile; },
    refreshProfiles: () => { refreshed++; },
    showConfirmWithCheckbox: async () => ({ ok: false, checkboxChecked: true }),
  });

  assert(saved === null, 'decline + checkbox does not save suppressWcsConsent');
  assert(refreshed === 0, 'decline + checkbox does not refresh a saved profile');
  assert(applyCalls === 0, 'decline + checkbox does not apply WCS normalization');
  assert(skipCalls === 1, 'decline + checkbox explicitly skips WCS normalization for this session');
  }

  {
  let saved: DeviceProfile | null = null;
  let refreshed = 0;
  let applyCalls = 0;
  let skipCalls = 0;
  const controller: ProfileAwareController = {
    applyWcsNormalization: () => { applyCalls++; },
    skipWcsNormalization: () => { skipCalls++; },
  };

  await handleWcsConsentForActiveProfile(payload, {
    controller,
    getActiveProfile: () => makeProfile(),
    saveDeviceProfile: (profile) => { saved = profile; },
    refreshProfiles: () => { refreshed++; },
    showConfirmWithCheckbox: async () => ({ ok: true, checkboxChecked: true }),
  });

  const savedAfterAccept = saved as DeviceProfile | null;
  assert(
    savedAfterAccept !== null && savedAfterAccept.suppressWcsConsent === true,
    'accept + checkbox saves future auto-normalization',
  );
  assert(refreshed === 1, 'accept + checkbox refreshes saved profile state');
  assert(applyCalls === 1, 'accept + checkbox applies WCS normalization');
  assert(skipCalls === 0, 'accept + checkbox does not skip WCS normalization');
  }

  {
  let prompts = 0;
  let applyCalls = 0;
  let skipCalls = 0;
  const controller: ProfileAwareController = {
    applyWcsNormalization: () => { applyCalls++; },
    skipWcsNormalization: () => { skipCalls++; },
  };

  await handleWcsConsentForActiveProfile(payload, {
    controller,
    getActiveProfile: () => makeProfile({ suppressWcsConsent: true }),
    saveDeviceProfile: () => { throw new Error('already-suppressed path should not save'); },
    refreshProfiles: () => { throw new Error('already-suppressed path should not refresh'); },
    showConfirmWithCheckbox: async () => {
      prompts++;
      return { ok: false, checkboxChecked: false };
    },
  });

  assert(prompts === 0, 'existing suppressWcsConsent skips prompt');
  assert(applyCalls === 1, 'existing suppressWcsConsent still applies WCS normalization');
  assert(skipCalls === 0, 'existing suppressWcsConsent does not skip');
  }
}

void main()
  .then(() => {
    console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
