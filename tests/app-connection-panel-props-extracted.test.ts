import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const builderPath = path.join(process.cwd(), 'src', 'ui', 'components', 'appConnectionPanelProps.ts');
const builderSource = fs.existsSync(builderPath) ? fs.readFileSync(builderPath, 'utf8') : '';

assert(
  appSource.includes('buildAppConnectionPanelProps'),
  'App.tsx should use a ConnectionPanel prop builder instead of a large inline object',
);
assert(
  builderSource.includes('buildAppConnectionPanelProps'),
  'appConnectionPanelProps should export buildAppConnectionPanelProps',
);
assert(
  builderSource.includes('ConnectionPanelProps'),
  'appConnectionPanelProps should preserve ConnectionPanel prop typing',
);
