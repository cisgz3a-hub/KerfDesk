import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveProductionModeToggle,
  resolveUserModeSelection,
} from '../src/ui/components/app/appModePreferenceHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

console.log('\n=== T2-6 Phase 3af app mode preference helpers ===\n');

assert(
  resolveUserModeSelection('beginner', 'beginner').kind === 'noop',
  'selecting the current user mode is a no-op',
);
{
  const result = resolveUserModeSelection('advanced', 'beginner');
  assert(result.kind === 'set' && result.mode === 'beginner', 'beginner mode applies without confirmation');
}
{
  const result = resolveUserModeSelection('beginner', 'advanced');
  assert(result.kind === 'confirm-advanced' && result.mode === 'advanced', 'advanced mode requires confirmation');
}

{
  const result = resolveProductionModeToggle({ productionMode: true, proUnlocked: false });
  assert(result.kind === 'set' && result.enabled === false, 'enabled production mode always toggles off');
}
{
  const result = resolveProductionModeToggle({ productionMode: false, proUnlocked: false });
  assert(result.kind === 'show-paywall', 'locked production mode opens the paywall decision');
}
{
  const result = resolveProductionModeToggle({ productionMode: false, proUnlocked: true });
  assert(result.kind === 'set' && result.enabled === true, 'unlocked production mode toggles on');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appModePreferenceHelpers.ts'), 'utf8');

assert(
  appSource.includes('resolveUserModeSelection'),
  'App imports and uses resolveUserModeSelection',
);
assert(
  appSource.includes('resolveProductionModeToggle'),
  'App imports and uses resolveProductionModeToggle',
);
assert(
  !appSource.includes('if (mode === userMode) return;'),
  'App no longer carries the user-mode no-op branch inline',
);
assert(
  !appSource.includes('if (productionMode) {'),
  'App no longer carries the production-mode toggle-off branch inline',
);
assert(
  helperSource.includes('T2-6 Phase 3af'),
  'appModePreferenceHelpers carries the T2-6 Phase 3af marker',
);

console.log('User-mode and production-mode decisions are extracted from App.');
