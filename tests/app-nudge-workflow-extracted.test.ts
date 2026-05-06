import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const hookPath = path.join(process.cwd(), 'src', 'ui', 'hooks', 'useAppNudgeWorkflow.ts');
const hookSource = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';

assert(
  appSource.includes("from '../hooks/useAppNudgeWorkflow'"),
  'App.tsx should consume the app nudge workflow hook',
);
assert(
  !appSource.includes('isNudgingRef'),
  'App.tsx should not own nudge-in-progress mutable state',
);
assert(
  !appSource.includes('nudgeSceneRef'),
  'App.tsx should not own pending nudge scene state',
);
assert(
  hookSource.includes('handleNudge'),
  'useAppNudgeWorkflow should expose handleNudge',
);
assert(
  hookSource.includes("handleSceneCommit(nudgeSceneRef.current, 'nudge')"),
  'useAppNudgeWorkflow should commit pending nudges with the nudge action',
);
