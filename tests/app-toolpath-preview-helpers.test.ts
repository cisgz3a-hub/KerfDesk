import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  shouldClearToolpathPreview,
  shouldCompileToolpathPreview,
} from '../src/ui/components/app/appToolpathPreviewHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

console.log('\n=== T2-6 Phase 3ai app toolpath preview helpers ===\n');

assert(
  shouldClearToolpathPreview({ showToolpathPreview: false, isJobRunning: false }),
  'preview off clears preview moves',
);
assert(
  shouldClearToolpathPreview({ showToolpathPreview: true, isJobRunning: true }),
  'running job clears preview moves',
);
assert(
  !shouldClearToolpathPreview({ showToolpathPreview: true, isJobRunning: false }),
  'active preview while idle does not clear preview moves',
);

assert(
  shouldCompileToolpathPreview({ showToolpathPreview: true, isJobRunning: false }),
  'active preview while idle may compile',
);
assert(
  !shouldCompileToolpathPreview({ showToolpathPreview: false, isJobRunning: false }),
  'hidden preview does not compile',
);
assert(
  !shouldCompileToolpathPreview({ showToolpathPreview: true, isJobRunning: true }),
  'running job never compiles preview',
);

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appToolpathPreviewHelpers.ts'), 'utf8');

assert(
  appSource.includes('shouldClearToolpathPreview'),
  'App imports and uses shouldClearToolpathPreview',
);
assert(
  appSource.includes('shouldCompileToolpathPreview'),
  'App imports and uses shouldCompileToolpathPreview',
);
assert(
  !appSource.includes('!showToolpathPreview || grbl.isJobRunning'),
  'App no longer carries the preview-clear boolean inline',
);
assert(
  !appSource.includes('grbl.isJobRunning || !showToolpathPreview'),
  'App no longer carries the preview-compile boolean inline',
);
assert(
  helperSource.includes('T2-6 Phase 3ai'),
  'appToolpathPreviewHelpers carries the T2-6 Phase 3ai marker',
);

console.log('Toolpath preview clear/compile decisions are extracted from App.');
