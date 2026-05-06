import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const hookSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'hooks', 'useAppDeviceProfiles.ts'), 'utf8');

const appDeviceProfileImport = appSource.match(
  /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\.\/\.\.\/core\/devices\/DeviceProfile['"];/,
);
const hookDeviceProfileImport = hookSource.match(
  /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\.\/\.\.\/core\/devices\/DeviceProfile['"];/,
);

assert(
  appSource.includes('useAppDeviceProfiles') || appDeviceProfileImport?.[0].includes('applyProfileToScene'),
  'App.tsx should either delegate profile application to useAppDeviceProfiles or import applyProfileToScene directly',
);
assert(
  hookDeviceProfileImport != null && hookDeviceProfileImport[0].includes('applyProfileToScene'),
  'useAppDeviceProfiles must import applyProfileToScene before applying active profile changes',
);
