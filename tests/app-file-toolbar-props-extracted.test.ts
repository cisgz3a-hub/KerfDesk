import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const builderPath = path.join(process.cwd(), 'src', 'ui', 'components', 'appFileToolbarProps.ts');
const builderSource = fs.existsSync(builderPath) ? fs.readFileSync(builderPath, 'utf8') : '';
const toolbarSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'FileToolbar.tsx'), 'utf8');

assert(
  appSource.includes('buildAppFileToolbarProps'),
  'App.tsx should use a FileToolbar prop builder instead of a large inline object',
);
assert(
  builderSource.includes('buildAppFileToolbarProps'),
  'appFileToolbarProps should export buildAppFileToolbarProps',
);
assert(
  builderSource.includes('FileToolbarProps'),
  'appFileToolbarProps should preserve FileToolbar prop typing',
);
assert(
  toolbarSource.includes('export interface FileToolbarProps'),
  'FileToolbarProps should be exported for the App prop builder',
);
