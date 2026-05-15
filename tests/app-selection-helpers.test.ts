/**
 * T2-6 Phase 3u: regression test for the pure selection helpers
 * extracted from App.tsx. These two helpers feed the App-level
 * selection state — filterValidIds keeps selections coherent
 * through scene mutations (undo/redo/paste/delete), and
 * selectAllSelectableIds builds the `Ctrl+A` selection set.
 *
 * Run: npx tsx tests/app-selection-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import {
  filterValidIds,
  hasSelectedTextObject,
  selectAllSelectableIds,
} from '../src/ui/components/app/appSelectionHelpers';

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

function obj(id: string, visible: boolean, locked: boolean): SceneObject {
  return { id, visible, locked, layerId: 'l1', name: id } as unknown as SceneObject;
}

function typedObj(id: string, type: string, visible = true, locked = false): SceneObject {
  return {
    id,
    visible,
    locked,
    layerId: 'l1',
    name: id,
    geometry: { type },
  } as unknown as SceneObject;
}

function scene(objects: SceneObject[]): Scene {
  return {
    id: 's',
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects,
    layers: [],
    activeLayerId: '',
    metadata: { name: 't' } as never,
  } as unknown as Scene;
}

console.log('\n=== T2-6 Phase 3u app selection helpers ===\n');

// -------- filterValidIds --------
{
  // Empty input → empty output
  const r = filterValidIds(new Set(), scene([obj('a', true, false)]));
  assert(r.size === 0, 'empty ids → empty set');
  // Returns a NEW set (not the input)
  const input = new Set<string>();
  const out = filterValidIds(input, scene([]));
  assert(out !== input, 'returns a new set instance (not the input)');
}
{
  // All IDs valid
  const s = scene([obj('a', true, false), obj('b', true, false)]);
  const r = filterValidIds(new Set(['a', 'b']), s);
  assert(r.size === 2 && r.has('a') && r.has('b'),
    'all ids present in scene → both preserved');
}
{
  // Some IDs stale
  const s = scene([obj('a', true, false)]);
  const r = filterValidIds(new Set(['a', 'stale1', 'stale2']), s);
  assert(r.size === 1 && r.has('a'),
    'stale ids dropped; valid id preserved');
  assert(!r.has('stale1') && !r.has('stale2'),
    'stale ids actually removed');
}
{
  // All IDs stale (scene replaced via undo)
  const s = scene([obj('new1', true, false)]);
  const r = filterValidIds(new Set(['old1', 'old2']), s);
  assert(r.size === 0, 'all stale → empty set');
}
{
  // Visibility / locked doesn't affect filterValidIds (only existence does)
  const s = scene([obj('a', false, true)]);
  const r = filterValidIds(new Set(['a']), s);
  assert(r.has('a'),
    'invisible+locked object still passes filterValidIds (existence only)');
}

// -------- selectAllSelectableIds --------
{
  // Empty scene
  const r = selectAllSelectableIds(scene([]));
  assert(r.size === 0, 'empty scene → empty set');
}
{
  // All visible + unlocked
  const s = scene([obj('a', true, false), obj('b', true, false), obj('c', true, false)]);
  const r = selectAllSelectableIds(s);
  assert(r.size === 3 && r.has('a') && r.has('b') && r.has('c'),
    'all selectable → all 3 ids');
}
{
  // Invisible objects skipped
  const s = scene([
    obj('vis', true, false),
    obj('hid', false, false),
  ]);
  const r = selectAllSelectableIds(s);
  assert(r.size === 1 && r.has('vis') && !r.has('hid'),
    'invisible object skipped');
}
{
  // Locked objects skipped
  const s = scene([
    obj('free', true, false),
    obj('lock', true, true),
  ]);
  const r = selectAllSelectableIds(s);
  assert(r.size === 1 && r.has('free') && !r.has('lock'),
    'locked object skipped');
}
{
  // Mixed: both visibility AND locked filters apply
  const s = scene([
    obj('ok', true, false),
    obj('hidden', false, false),
    obj('locked', true, true),
    obj('hidden+locked', false, true),
  ]);
  const r = selectAllSelectableIds(s);
  assert(r.size === 1 && r.has('ok'),
    'only objects visible AND unlocked qualify');
}

// -------- hasSelectedTextObject --------
{
  const s = scene([
    typedObj('name', 'text'),
    typedObj('rect', 'rect'),
  ]);
  assert(hasSelectedTextObject(s, new Set(['name'])),
    'selected text object is detected');
  assert(!hasSelectedTextObject(s, new Set(['rect'])),
    'selected non-text object is not treated as text');
  assert(!hasSelectedTextObject(s, new Set(['missing'])),
    'unselected text object is not detected');
}

// -------- Source-level pin: App.tsx delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const appSrc = readFileSync(
    resolve(here, '../src/ui/components/App.tsx'),
    'utf-8',
  );
  assert(/from '\.\/app\/appSelectionHelpers'/.test(appSrc),
    'App imports from ./app/appSelectionHelpers');
  assert(/T2-6 Phase 3u|Phase 3u/.test(appSrc),
    'App.tsx carries Phase 3u marker');
  assert(/selectAllSelectableIds\(scene\)/.test(appSrc),
    'App calls selectAllSelectableIds(scene)');
  assert(/hasSelectedTextObject\(scene, selectedIds\)/.test(appSrc),
    'App calls hasSelectedTextObject(scene, selectedIds)');
  // Inline filterValidIds is gone (no `function filterValidIds(` declaration)
  assert(!/^function filterValidIds/m.test(appSrc),
    'inline filterValidIds is gone from App.tsx');
  // Inline `scene.objects.filter(o => o.visible && !o.locked).map(o => o.id)`
  // pattern is gone (now lives in selectAllSelectableIds)
  assert(!/scene\.objects\.filter\(o => o\.visible && !o\.locked\)\.map\(o => o\.id\)/.test(appSrc),
    'inline visible-and-unlocked filter is gone from App.tsx');
  assert(!/scene\.objects\.some\(o\s*=>\s*selectedIds\.has\(o\.id\)\s*&&\s*o\.geometry\.type === 'text'\s*\)/s.test(appSrc),
    'inline selected-text scan is gone from App.tsx');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/app/appSelectionHelpers.ts'),
    'utf-8',
  );
  assert(/T2-6 Phase 3u|Phase 3u/.test(helperSrc),
    'appSelectionHelpers carries Phase 3u marker');
  assert(/T2-6 Phase 3ao|Phase 3ao/.test(helperSrc),
    'appSelectionHelpers carries Phase 3ao marker');
  assert(/export function filterValidIds/.test(helperSrc),
    'filterValidIds is exported');
  assert(/export function selectAllSelectableIds/.test(helperSrc),
    'selectAllSelectableIds is exported');
  assert(/export function hasSelectedTextObject/.test(helperSrc),
    'hasSelectedTextObject is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
