import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');

const deviceProfileImport = appSource.match(
  /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\.\/\.\.\/core\/devices\/DeviceProfile['"];/,
);

assert(
  deviceProfileImport != null,
  'App.tsx should import DeviceProfile helpers from core/devices/DeviceProfile',
);
assert(
  deviceProfileImport[0].includes('applyProfileToScene'),
  'App.tsx must import applyProfileToScene before using it in setActiveProfileAndApply',
);
