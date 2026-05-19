/**
 * LightBurn-derived UI recovery regression:
 * users need a one-click way to reset the working layout/view state.
 *
 * Run: npx tsx tests/lightburn-layout-reset-affordance.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toolbarSource = readFileSync('src/ui/components/FileToolbar.tsx', 'utf8');
const appSource = readFileSync('src/ui/components/App.tsx', 'utf8');
const viewportStoreSource = readFileSync('src/ui/stores/viewportStore.ts', 'utf8');

assert.match(viewportStoreSource, /resetViewport:\s*\(\)\s*=>\s*void/, 'viewport store exposes resetViewport');
assert.match(toolbarSource, /onResetLayout\?:\s*\(\)\s*=>\s*void/, 'FileToolbar accepts a reset-layout callback');
assert.match(toolbarSource, /Reset Layout/, 'FileToolbar exposes a Reset Layout button');
assert.match(appSource, /const resetViewport = useViewportStore\(s => s\.resetViewport\)/, 'App reads resetViewport from store');
assert.match(appSource, /const handleResetLayout = useCallback/, 'App defines a reset layout handler');
assert.match(appSource, /resetViewport\(\)/, 'reset layout handler resets viewport state');
assert.match(appSource, /setShowToolpathPreview\(false\)/, 'reset layout handler clears toolpath overlay');
assert.match(appSource, /setGcodePreview\(null\)/, 'reset layout handler closes G-code preview modal');
assert.match(appSource, /viewportActionsRef\.current\?\.fitToBed\(\)/, 'reset layout handler fits the bed after reset');
assert.match(appSource, /onResetLayout:\s*handleResetLayout/, 'App wires reset-layout handler into FileToolbar');
