import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTextPreviewFontLoadRequest } from '../src/ui/components/app/appTextPreviewFontHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

console.log('\n=== T2-6 Phase 3aj app text preview font helpers ===\n');

assert(
  buildTextPreviewFontLoadRequest({
    showTextDialog: false,
    textBold: false,
    textFont: 'Inter',
    textInput: 'Name',
    textItalic: false,
    textSize: 12,
  }) === null,
  'closed text dialog produces no font-load request',
);

{
  const result = buildTextPreviewFontLoadRequest({
    showTextDialog: true,
    textBold: true,
    textFont: 'Inter',
    textInput: 'Johann',
    textItalic: true,
    textSize: 12,
  });
  assert(result !== null, 'open text dialog produces a font-load request');
  assert(result.fontSpec === 'italic bold 24px "Inter"', `fontSpec includes style/weight/size/family (got ${result.fontSpec})`);
  assert(result.sample === 'Johann', 'font-load sample uses typed text');
}

{
  const result = buildTextPreviewFontLoadRequest({
    showTextDialog: true,
    textBold: false,
    textFont: 'Arial',
    textInput: '',
    textItalic: false,
    textSize: 100,
  });
  assert(result?.fontSpec === '48px "Arial"', `font size caps at 48px (got ${result?.fontSpec})`);
  assert(result.sample === 'Preview', 'empty text falls back to Preview sample');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appTextPreviewFontHelpers.ts'), 'utf8');

assert(
  appSource.includes('buildTextPreviewFontLoadRequest'),
  'App imports and uses buildTextPreviewFontLoadRequest',
);
assert(
  !appSource.includes('previewFontSizePx'),
  'App no longer carries preview font pixel conversion inline',
);
assert(
  !appSource.includes("dialogs.textInput || 'Preview'"),
  'App no longer carries preview sample fallback inline',
);
assert(
  appSource.includes("setTextPreviewFontStatus('failed')"),
  'App records rejected document.fonts.load as failed instead of ready',
);
assert(
  !appSource.includes("catch(() => {\n        if (!cancelled) setTextPreviewFontStatus('ready');"),
  'App must not hide rejected font loads as ready',
);
assert(
  helperSource.includes('T2-6 Phase 3aj'),
  'appTextPreviewFontHelpers carries the T2-6 Phase 3aj marker',
);

console.log('Text preview font-load request formatting is extracted from App.');
