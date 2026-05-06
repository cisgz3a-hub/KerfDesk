import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const hookPath = path.join(process.cwd(), 'src', 'ui', 'hooks', 'useAppDeviceProfiles.ts');
const hookSource = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';

assert(
  appSource.includes("from '../hooks/useAppDeviceProfiles'"),
  'App.tsx should consume the device-profile orchestration hook',
);
assert(
  !appSource.includes('initializeDeviceProfiles'),
  'App.tsx should not own device-profile initialization directly',
);
assert(
  !appSource.includes('migrateDeviceProfileResponseCurves'),
  'App.tsx should not own profile response-curve migration directly',
);
assert(
  hookSource.includes('initializeDeviceProfiles'),
  'useAppDeviceProfiles should own device-profile initialization',
);
assert(
  hookSource.includes('handleAutoDetectMachine'),
  'useAppDeviceProfiles should own auto-detect profile update wiring',
);
