/**
 * T2-78 regression test: HistoryManager entries with action metadata.
 *
 * The existing history.test.ts (99 assertions) verifies the cursor-and-
 * stack mechanics with the bare-Scene API. This file exercises the
 * metadata API specifically:
 *
 *   - push(scene, meta) and reset(scene, meta) carry metadata into the
 *     stored HistoryEntry.
 *   - Defaults are applied when meta or its fields are omitted.
 *   - The new entry-returning forms (undoEntry / redoEntry /
 *     getCurrentEntry) expose the metadata to consumers.
 *   - The legacy Scene-returning forms (undo / redo / getCurrent)
 *     continue to work unchanged.
 *   - Defensive copy: mutating a passed-in selection set after push
 *     does NOT alter what the entry stores.
 *
 * T2-79 (selection restore on undo/redo) and T2-80 (history coalescing)
 * both depend on these metadata fields. Failures here block both.
 *
 * Run: npx tsx tests/history-entry-metadata.test.ts
 */
import { HistoryManager } from '../src/ui/history/HistoryManager';
import { createScene, type Scene } from '../src/core/scene/Scene';

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function setEq<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const sA: Scene = createScene(400, 300, 'A');
const sB: Scene = createScene(400, 300, 'B');
const sC: Scene = createScene(400, 300, 'C');

console.log('\n=== T2-78 history entry metadata ===\n');

// ── 1. push with full metadata is preserved on getCurrentEntry ─────────
{
  const h = new HistoryManager();
  const before = new Set(['x']);
  const after = new Set(['y', 'z']);
  h.push(sA, {
    action: 'paste',
    timestamp: 12345,
    selectionBefore: before,
    selectionAfter: after,
  });

  const entry = h.getCurrentEntry();
  assert(entry !== null, 'getCurrentEntry() returns the entry');
  if (entry) {
    assert(entry.scene === sA, 'entry.scene is the pushed scene reference');
    assert(entry.action === 'paste', "entry.action === 'paste'");
    assert(entry.timestamp === 12345, 'entry.timestamp preserved');
    assert(setEq(entry.selectionBefore, before), 'entry.selectionBefore preserved');
    assert(setEq(entry.selectionAfter, after), 'entry.selectionAfter preserved');
  }
}

// ── 2. push without metadata applies defaults ──────────────────────────
{
  const h = new HistoryManager();
  const tBefore = Date.now();
  h.push(sA);
  const tAfter = Date.now();

  const entry = h.getCurrentEntry();
  if (entry) {
    assert(entry.action === 'edit', "default action === 'edit'");
    assert(
      entry.timestamp >= tBefore && entry.timestamp <= tAfter,
      'default timestamp is Date.now()-ish',
    );
    assert(entry.selectionBefore.size === 0, 'default selectionBefore is empty');
    assert(entry.selectionAfter.size === 0, 'default selectionAfter is empty');
  }
}

// ── 3. push with partial metadata fills missing fields with defaults ──
{
  const h = new HistoryManager();
  h.push(sA, { action: 'duplicate' });
  const entry = h.getCurrentEntry();
  if (entry) {
    assert(entry.action === 'duplicate', 'partial meta: action set');
    assert(typeof entry.timestamp === 'number', 'partial meta: timestamp filled');
    assert(entry.selectionBefore.size === 0, 'partial meta: selectionBefore default empty');
    assert(entry.selectionAfter.size === 0, 'partial meta: selectionAfter default empty');
  }
}

// ── 4. legacy getCurrent() still returns just the scene ────────────────
{
  const h = new HistoryManager();
  h.push(sA, { action: 'paste' });
  assert(h.getCurrent() === sA, 'getCurrent() returns the Scene reference');
}

// ── 5. undoEntry / redoEntry expose entries; legacy undo / redo unchanged
{
  const h = new HistoryManager();
  h.push(sA, { action: 'init' });
  h.push(sB, { action: 'paste', selectionAfter: new Set(['p']) });
  h.push(sC, { action: 'delete', selectionAfter: new Set() });

  // Cursor at C (latest). undoEntry should move to B and return B's entry.
  const undone = h.undoEntry();
  assert(undone !== null, 'undoEntry returns entry after canUndo');
  if (undone) {
    assert(undone.scene === sB, 'undoEntry returns the now-current entry (sB)');
    assert(undone.action === 'paste', 'undoEntry preserves action');
    assert(setEq(undone.selectionAfter, new Set(['p'])), 'undoEntry preserves selectionAfter');
  }

  // redoEntry should advance to C.
  const redone = h.redoEntry();
  assert(redone !== null, 'redoEntry returns entry after canRedo');
  if (redone) {
    assert(redone.scene === sC, 'redoEntry returns the now-current entry (sC)');
    assert(redone.action === 'delete', 'redoEntry preserves action');
  }

  // Legacy undo/redo still return Scene | null.
  const sceneUndo = h.undo();
  assert(sceneUndo === sB, 'legacy undo() returns the Scene at the new cursor');
  const sceneRedo = h.redo();
  assert(sceneRedo === sC, 'legacy redo() returns the Scene at the new cursor');
}

// ── 6. undoEntry / redoEntry return null at the boundaries ─────────────
{
  const h = new HistoryManager();
  h.push(sA);
  // Cursor at sA - only one entry, can't undo.
  assert(h.undoEntry() === null, 'undoEntry returns null when canUndo is false');
  assert(h.redoEntry() === null, 'redoEntry returns null when canRedo is false');
  assert(h.undo() === null, 'legacy undo returns null at boundary');
  assert(h.redo() === null, 'legacy redo returns null at boundary');
}

// ── 7. reset with metadata seeds a single entry ────────────────────────
{
  const h = new HistoryManager();
  h.push(sA);
  h.push(sB);
  h.reset(sC, { action: 'load:file', selectionAfter: new Set(['c1']) });

  assert(h.length === 1, 'reset replaces stack with single entry');
  assert(h.cursor === 0, 'reset places cursor at 0');
  const entry = h.getCurrentEntry();
  if (entry) {
    assert(entry.scene === sC, 'reset entry has the new scene');
    assert(entry.action === 'load:file', 'reset entry has action');
    assert(setEq(entry.selectionAfter, new Set(['c1'])), 'reset entry has selectionAfter');
  }
  assert(!h.canUndo(), 'reset clears undo availability');
  assert(!h.canRedo(), 'reset clears redo availability');
}

// ── 8. defensive copy: mutating the source set does not corrupt entry ─
{
  const h = new HistoryManager();
  const sel = new Set(['original']);
  h.push(sA, { action: 'edit', selectionBefore: sel, selectionAfter: sel });
  // Mutate the source set after push.
  sel.add('mutated');

  const entry = h.getCurrentEntry();
  if (entry) {
    assert(
      !entry.selectionBefore.has('mutated'),
      'selectionBefore is defensively copied',
    );
    assert(
      !entry.selectionAfter.has('mutated'),
      'selectionAfter is defensively copied',
    );
    assert(
      entry.selectionBefore.has('original'),
      'original selection content preserved',
    );
  }
}

// ── 9. dedup still works on scene-reference equality (post-T2-78) ──────
{
  const h = new HistoryManager();
  h.push(sA, { action: 'init' });
  // Same scene, different metadata - should be deduped per the
  // documented contract: "Compare scene reference only - metadata can
  // legitimately differ between two calls that produce the same scene."
  h.push(sA, { action: 'redundant-attempt', selectionAfter: new Set(['x']) });
  assert(h.length === 1, 'dedup: same scene reference with different meta is deduplicated');

  const entry = h.getCurrentEntry();
  if (entry) {
    assert(entry.action === 'init', 'dedup: original entry preserved (later call ignored)');
  }
}

// ── 10. SceneTransaction-derived action labels round-trip correctly ─
// The dispatcher inside SceneTransaction.ts derives labels of shape
// 'load:<source>', 'async:<operation>', and SceneCommitAction strings
// for edits. Verify the manager round-trips them as opaque strings.
{
  const h = new HistoryManager();
  h.push(sA, { action: 'load:autosave' });
  h.push(sB, { action: 'async:trace' });
  h.push(sC, { action: 'layer-fill-setting' });

  const cur = h.getCurrentEntry();
  if (cur) {
    assert(cur.action === 'layer-fill-setting', 'kebab-case action round-trips');
  }
  const u1 = h.undoEntry();
  if (u1) {
    assert(u1.action === 'async:trace', 'colon-prefixed async action round-trips');
  }
  const u2 = h.undoEntry();
  if (u2) {
    assert(u2.action === 'load:autosave', 'colon-prefixed load action round-trips');
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
