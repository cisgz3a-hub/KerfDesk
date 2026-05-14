/**
 * Autosave must not mark the user's manual project file clean.
 *
 * Run: npx tsx tests/autosave-manual-save-separation.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== autosave/manual-save separation ===\n');

const app = readFileSync(resolve('src/ui/components/App.tsx'), 'utf8');
const autosaveStart = app.indexOf('const interval = setInterval(() => {');
const autosaveEnd = app.indexOf('return () => clearInterval(interval);', autosaveStart);
const autosaveBody = autosaveStart >= 0 && autosaveEnd > autosaveStart
  ? app.slice(autosaveStart, autosaveEnd)
  : '';
const exitStart = app.indexOf('const handleExit = useCallback');
const exitEnd = app.indexOf('const handleCameraPositionDesign', exitStart);
const exitBody = exitStart >= 0 && exitEnd > exitStart ? app.slice(exitStart, exitEnd) : '';
const fileHandlersStart = app.indexOf('useFileHandlers({');
const fileHandlersEnd = app.indexOf('});', fileHandlersStart);
const fileHandlersBody = fileHandlersStart >= 0 && fileHandlersEnd > fileHandlersStart
  ? app.slice(fileHandlersStart, fileHandlersEnd)
  : '';

assert(/lastManualSaveHashRef/.test(app), 'App tracks a manual-save hash separately');
assert(/lastAutosaveHashRef/.test(app), 'App tracks an autosave hash separately');
assert(!/lastSavedSceneHashRef/.test(app), 'old shared saved hash ref is gone');

assert(autosaveBody.length > 0, 'autosave interval body found');
assert(/lastAutosaveHashRef\.current/.test(autosaveBody), 'autosave compares/updates the autosave hash');
assert(!/lastManualSaveHashRef\.current\s*=\s*currentHash/.test(autosaveBody),
  'autosave success does not update the manual-save hash');

assert(exitBody.length > 0, 'exit handler body found');
assert(/isDirty\(scene,\s*lastManualSaveHashRef\.current/.test(exitBody),
  'exit dirty prompt uses the manual-save hash');

assert(fileHandlersBody.length > 0, 'useFileHandlers wiring found');
assert(/isSceneDirty:[\s\S]{0,120}lastManualSaveHashRef\.current/.test(fileHandlersBody),
  'New/Open dirty checks use the manual-save hash');
assert(/markSceneSaved:[\s\S]{0,180}lastManualSaveHashRef\.current/.test(fileHandlersBody),
  'manual save callback updates the manual-save hash');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
