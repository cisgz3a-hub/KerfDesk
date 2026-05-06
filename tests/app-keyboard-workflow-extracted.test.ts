import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const hookPath = path.join(process.cwd(), 'src', 'ui', 'hooks', 'useAppKeyboardWorkflow.ts');
const hookSource = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';

assert(
  appSource.includes("from '../hooks/useAppKeyboardWorkflow'"),
  'App.tsx should consume the app keyboard workflow hook',
);
assert(
  !appSource.includes('useKeyboardShortcuts('),
  'App.tsx should not compose keyboard shortcut actions directly',
);
assert(
  hookSource.includes('useKeyboardShortcuts'),
  'useAppKeyboardWorkflow should compose useKeyboardShortcuts',
);
assert(
  hookSource.includes('onNudge: handleNudge'),
  'useAppKeyboardWorkflow should preserve nudge shortcut wiring',
);
assert(
  hookSource.includes("setActiveTool('select')"),
  'useAppKeyboardWorkflow should preserve Escape/select tool wiring',
);
