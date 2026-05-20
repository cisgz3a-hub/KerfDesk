import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const hookPath = path.join(process.cwd(), 'src', 'ui', 'hooks', 'useAppGeneratorWorkflows.ts');
const hookSource = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';

assert(
  appSource.includes("from '../hooks/useAppGeneratorWorkflows'"),
  'App.tsx should consume the app generator-workflow hook',
);
assert(
  !appSource.includes("from '../hooks/useGeneratorHandlers'"),
  'App.tsx should not compose generator handlers directly',
);
assert(
  !appSource.includes('setGridArrayBounds({ w: maxX - minX, h: maxY - minY })'),
  'App.tsx should not compute grid-array launch bounds directly',
);
assert(
  !appSource.includes('openGridArray: () => setShowGridArray(true)'),
  'App context menu must not bypass grid-array bounds computation',
);
assert(
  appSource.includes('openGridArray: handleGridArray'),
  'App context menu should route Grid Array through handleGridArray',
);
assert(
  hookSource.includes('useGeneratorHandlers'),
  'useAppGeneratorWorkflows should compose the generator handlers',
);
assert(
  hookSource.includes('handleGridArray'),
  'useAppGeneratorWorkflows should own grid-array launch bounds',
);
assert(
  hookSource.includes('openBoxStudio') && hookSource.includes('closeBoxStudio'),
  'useAppGeneratorWorkflows should own Box Studio route handlers',
);
