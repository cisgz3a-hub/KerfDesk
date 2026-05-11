/**
 * T2-6 Phase 3v: regression test for the pure layer-mode derivation
 * helpers extracted from App.tsx.
 *
 *   - activeLayerMode: active layer's mode, fallback to first
 *     layer's mode, fallback to 'cut'.
 *   - interactableLayerIds: every layer ID matching the active
 *     mode.
 *
 * Run: npx tsx tests/app-layer-mode-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/core/scene/Scene';
import type { Layer, LayerMode } from '../src/core/scene/Layer';
import {
  activeLayerMode,
  interactableLayerIds,
} from '../src/ui/components/app/appLayerModeHelpers';

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

function layer(id: string, mode: LayerMode): Layer {
  return {
    id,
    name: id,
    color: '#000',
    visible: true,
    locked: false,
    output: true,
    settings: { mode } as never,
  } as unknown as Layer;
}

function scene(layers: Layer[], activeLayerId: string): Scene {
  return {
    id: 's',
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects: [],
    layers,
    activeLayerId,
    metadata: { name: 't' } as never,
  } as unknown as Scene;
}

console.log('\n=== T2-6 Phase 3v app layer-mode helpers ===\n');

// -------- activeLayerMode --------
{
  // Active layer found
  const s = scene([layer('a', 'cut'), layer('b', 'engrave')], 'b');
  assert(activeLayerMode(s) === 'engrave',
    'active layer found → mode of active layer');
}
{
  // Active layer NOT found → fallback to first layer
  const s = scene([layer('a', 'cut'), layer('b', 'engrave')], 'missing');
  assert(activeLayerMode(s) === 'cut',
    'active layer missing → first layer\'s mode');
}
{
  // No layers at all → fallback to 'cut'
  const s = scene([], 'whatever');
  assert(activeLayerMode(s) === 'cut',
    'empty layers → "cut" default');
}
{
  // Each LayerMode preserved
  for (const mode of ['cut', 'engrave', 'score', 'image'] as LayerMode[]) {
    const s = scene([layer('only', mode)], 'only');
    assert(activeLayerMode(s) === mode,
      `mode "${mode}" round-trips through activeLayerMode`);
  }
}

// -------- interactableLayerIds --------
{
  // Single layer
  const s = scene([layer('only', 'cut')], 'only');
  const r = interactableLayerIds(s);
  assert(r.size === 1 && r.has('only'),
    'single layer → its own id');
}
{
  // Multiple layers, all same mode
  const s = scene(
    [layer('a', 'cut'), layer('b', 'cut'), layer('c', 'cut')],
    'a',
  );
  const r = interactableLayerIds(s);
  assert(r.size === 3 && r.has('a') && r.has('b') && r.has('c'),
    'all-same-mode → all 3 ids');
}
{
  // Mixed: active = engrave, so only engrave layers in set
  const s = scene(
    [layer('cut1', 'cut'), layer('eng1', 'engrave'), layer('eng2', 'engrave'), layer('sc1', 'score')],
    'eng1',
  );
  const r = interactableLayerIds(s);
  assert(r.size === 2 && r.has('eng1') && r.has('eng2'),
    'mixed modes, active=engrave → 2 engrave ids (not cut, not score)');
}
{
  // Active missing → fallback to first layer's mode
  const s = scene(
    [layer('cut1', 'cut'), layer('cut2', 'cut'), layer('eng1', 'engrave')],
    'gone',
  );
  const r = interactableLayerIds(s);
  // First layer is cut → only cut layers eligible
  assert(r.size === 2 && r.has('cut1') && r.has('cut2'),
    'active missing → first layer mode (cut) → 2 cut ids');
}
{
  // Empty scene
  const r = interactableLayerIds(scene([], ''));
  assert(r.size === 0, 'empty scene → empty set');
}

// -------- Source-level pin: App.tsx delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const appSrc = readFileSync(
    resolve(here, '../src/ui/components/App.tsx'),
    'utf-8',
  );
  assert(/from '\.\/app\/appLayerModeHelpers'/.test(appSrc),
    'App imports from ./app/appLayerModeHelpers');
  assert(/T2-6 Phase 3v|Phase 3v/.test(appSrc),
    'App.tsx carries Phase 3v marker');
  // Inline `scene.layers.find(l => l.id === scene.activeLayerId)` followed by
  // `.settings.mode ?? scene.layers[0]?.settings.mode ?? 'cut'` is gone.
  assert(
    !/layer\?\.settings\.mode \?\? scene\.layers\[0\]\?\.settings\.mode \?\? 'cut'/.test(appSrc),
    'inline activeLayerMode fallback chain is gone from App.tsx',
  );
  // The inline `new Set(scene.layers.filter(l => l.settings.mode === mode).map(l => l.id))`
  // useMemo body (with that specific shape) is gone — only the helper call remains.
  assert(
    !/return new Set\(\s*scene\.layers\.filter\(l => l\.settings\.mode === mode\)\.map\(l => l\.id\)/.test(appSrc),
    'inline interactableLayerIds Set construction is gone from App.tsx',
  );

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/app/appLayerModeHelpers.ts'),
    'utf-8',
  );
  assert(/T2-6 Phase 3v|Phase 3v/.test(helperSrc),
    'appLayerModeHelpers carries Phase 3v marker');
  assert(/export function activeLayerMode/.test(helperSrc),
    'activeLayerMode is exported');
  assert(/export function interactableLayerIds/.test(helperSrc),
    'interactableLayerIds is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
