/**
 * LightBurn-derived workflow regression:
 * material/test-grid G-code should be previewable before it is exported or run.
 *
 * Run: npx tsx tests/test-grid-dialog-preview-flow.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialogSource = readFileSync('src/ui/components/TestGridDialog.tsx', 'utf8');
const toolbarSource = readFileSync('src/ui/components/FileToolbar.tsx', 'utf8');
const appSource = readFileSync('src/ui/components/App.tsx', 'utf8');

assert.match(
  dialogSource,
  /onPreview\?:\s*\(gcode:\s*string,\s*bounds:\s*\{\s*width:\s*number;\s*height:\s*number\s*\}\)\s*=>\s*void/,
  'TestGridDialog accepts a preview callback with generated G-code and bounds',
);
assert.match(dialogSource, /Preview G-code/, 'TestGridDialog exposes a preview action');
assert.match(
  dialogSource,
  /onPreview\?\.\(gcode,\s*\{\s*width,\s*height\s*\}\)/,
  'Preview action sends the exact generated G-code to the preview callback',
);

assert.match(toolbarSource, /onPreviewGcode\?:\s*\(gcode:\s*string\)\s*=>\s*void/, 'FileToolbar exposes preview callback');
assert.match(toolbarSource, /onPreview:\s*onPreviewGcode/, 'FileToolbar wires TestGridDialog preview to App preview');
assert.match(appSource, /onPreviewGcode:\s*setGcodePreview/, 'App opens the existing G-code preview for test-grid output');
