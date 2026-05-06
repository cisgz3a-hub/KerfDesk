import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const hookPath = path.join(process.cwd(), 'src', 'ui', 'hooks', 'useAppMaterialWorkflows.ts');
const hookSource = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';

assert(
  appSource.includes("from '../hooks/useAppMaterialWorkflows'"),
  'App.tsx should consume the app material-workflow hook',
);
assert(
  !appSource.includes("from '../hooks/useKerfHandlers'"),
  'App.tsx should not wire kerf handlers directly',
);
assert(
  !appSource.includes("from '../hooks/useMaterialHandlers'"),
  'App.tsx should not wire material handlers directly',
);
assert(
  !appSource.includes("from '../hooks/useMaterialTestHandlers'"),
  'App.tsx should not wire material-test handlers directly',
);
assert(
  hookSource.includes('handleCalibrationCurveReady'),
  'useAppMaterialWorkflows should own calibration curve persistence',
);
assert(
  hookSource.includes('useKerfHandlers'),
  'useAppMaterialWorkflows should compose the kerf handlers',
);
