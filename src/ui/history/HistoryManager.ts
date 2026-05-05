/**
 * === FILE: /src/ui/history/HistoryManager.ts ===
 *
 * Purpose:    Cursor-based undo/redo history for Scene snapshots.
 *
 *             Design:
 *             - Linear history (no branching)
 *             - Cursor points to the current snapshot
 *             - push() adds after cursor, truncates any redo entries
 *             - undo() moves cursor back
 *             - redo() moves cursor forward
 *             - Max size evicts oldest entries
 *
 *             Memory:
 *             - Stores Scene references, not deep copies
 *             - SceneOps already uses structural sharing (spread)
 *             - Unchanged objects share references across snapshots
 *             - 100 snapshots × ~8KB per diff ≈ ~1MB worst case
 *
 * Dependencies: /src/core/scene/Scene.ts
 * Last updated: Undo/Redo feature
 */

import { type Scene } from '../../core/scene/Scene';
import { stripRegenerableImageCaches } from './stripRegenerableCaches';
import { estimateSceneBytes } from './estimateSceneBytes';

// ─── TYPES ───────────────────────────────────────────────────────

export type HistoryChangeCallback = (state: HistoryState) => void;

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;     // How many undos are available
  redoDepth: number;     // How many redos are available
  totalSnapshots: number;
}

/**
 * T2-78: a single history snapshot with metadata.
 *
 * The metadata is what makes T2-79 (selection restore on undo/redo)
 * and T2-80 (history coalescing) possible - both need to know what
 * action produced each entry, when it happened, and what selection
 * the user had before/after the change.
 *
 * `action` is open-string. Conventional values:
 * - `'init'` for the initial scene seed.
 * - `'edit'` as a generic fallback.
 * - kebab-case nouns describing the user action when known
 *   (e.g. `'paste'`, `'layer-mode'`, `'array-clone'`). T2-76 step 7's
 *   `SceneCommitAction` union is the source of these on the edit path.
 * - `'load:new'`, `'load:file'`, `'load:autosave'` for load reasons.
 * - `'async:<operation>'` for async-result reasons.
 *
 * `selectionBefore` and `selectionAfter` are stored as fresh
 * `ReadonlySet<string>` to prevent accidental mutation by future
 * consumers from corrupting history. Callers may pass any iterable;
 * the manager copies into a new Set on push.
 */
export interface HistoryEntry {
  readonly scene: Scene;
  readonly action: string;
  readonly timestamp: number;
  readonly selectionBefore: ReadonlySet<string>;
  readonly selectionAfter: ReadonlySet<string>;
}

/**
 * Optional metadata that callers can attach to a push or reset. All
 * fields default to neutral values when omitted, so existing callers
 * that pre-date T2-78 (e.g. plain `push(scene)`) continue to work.
 */
export interface HistoryEntryMeta {
  action?: string;
  timestamp?: number;
  selectionBefore?: ReadonlySet<string>;
  selectionAfter?: ReadonlySet<string>;
}

const DEFAULT_ACTION = 'edit';

function buildEntry(scene: Scene, meta: HistoryEntryMeta | undefined): HistoryEntry {
  // T2-81: strip regenerable per-object caches before snapshotting.
  // `processedData` (T1-17 Pass 4b/4c JobCompiler cache) is per-
  // slider-commit and dominates history memory for image-heavy
  // workflows; it can be re-derived from grayscaleData + settings
  // so dropping it from snapshots is safe.
  const sceneForHistory = stripRegenerableImageCaches(scene);
  return {
    scene: sceneForHistory,
    action: meta?.action ?? DEFAULT_ACTION,
    timestamp: meta?.timestamp ?? Date.now(),
    selectionBefore: new Set(meta?.selectionBefore ?? []),
    selectionAfter: new Set(meta?.selectionAfter ?? []),
  };
}

// ─── HISTORY MANAGER ─────────────────────────────────────────────

/** T2-82: default history byte budget. 100MB matches the audit's
 *  recommendation; image-heavy projects after T2-81's strip stay
 *  under this for hundreds of entries, raster-only catastrophic
 *  cases evict before browser slowdown territory. */
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export class HistoryManager {
  private _stack: HistoryEntry[] = [];
  private _cursor = -1;            // Index of current entry
  private _maxSize: number;
  private _maxBytes: number;
  /** T2-82: index-aligned with `_stack`; cached at push time so
   *  `totalBytes()` is O(stack.length). */
  private _entryBytes: number[] = [];
  private _listeners = new Set<HistoryChangeCallback>();
  // T2-81: tracks the most recently push()'d scene's PRE-strip
  // reference. The no-op-commit guard (mouseUp without movement
  // calls push with the same Scene object) compares incoming scene
  // identity to this, not to the stored stripped scene — stripping
  // the cache produces a different object even when the user-
  // observable scene is unchanged.
  private _lastPushedScene: Scene | null = null;

  constructor(maxSize: number = 100, maxBytes: number = DEFAULT_MAX_BYTES) {
    this._maxSize = Math.max(1, maxSize);
    this._maxBytes = Math.max(1024, maxBytes);
  }

  // ─── CURRENT STATE ───────────────────────────────────────────

  /** The current Scene, or null if history is empty. */
  getCurrent(): Scene | null {
    const entry = this.getCurrentEntry();
    return entry === null ? null : entry.scene;
  }

  /**
   * T2-78: the current entry with metadata, or null if history is empty.
   * Use this when you need the action label / selection state alongside
   * the scene; otherwise {@link getCurrent} is the simpler API.
   */
  getCurrentEntry(): HistoryEntry | null {
    if (this._cursor < 0 || this._cursor >= this._stack.length) {
      return null;
    }
    return this._stack[this._cursor];
  }

  /** Whether undo is available. */
  canUndo(): boolean {
    return this._cursor > 0;
  }

  /** Whether redo is available. */
  canRedo(): boolean {
    return this._cursor < this._stack.length - 1;
  }

  /** Read-only snapshot of the history state. */
  getState(): HistoryState {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoDepth: this._cursor,
      redoDepth: this._stack.length - 1 - this._cursor,
      totalSnapshots: this._stack.length,
    };
  }

  // ─── DEBUG / INSPECTION ──────────────────────────────────────

  /** Number of snapshots in the stack. */
  get length(): number { return this._stack.length; }

  /** Current cursor position (0-based index into the stack). */
  get cursor(): number { return this._cursor; }

  // ─── MUTATIONS ───────────────────────────────────────────────

  /**
   * Push a new Scene snapshot onto the history.
   *
   * - Truncates any redo entries after the cursor
   * - Evicts oldest entries if max size exceeded
   * - Moves cursor to the new entry
   */
  push(scene: Scene, meta?: HistoryEntryMeta): void {
    // Skip if identical to current snapshot (prevents duplicate entries
    // from no-op commits like mouseUp without movement). Compare scene
    // reference only - metadata can legitimately differ between two
    // calls that produce the same scene.
    // T2-81: compare to the PRE-strip reference, not the stored entry's
    // scene. Stripping returns a new object for image-cache cases, so
    // the stored entry would never equal the incoming scene by identity
    // and the guard would silently fail to detect the no-op commit.
    if (this._lastPushedScene === scene) return;

    const entry = buildEntry(scene, meta);

    // Truncate redo history — everything after cursor is discarded
    this._stack.length = this._cursor + 1;
    this._entryBytes.length = this._cursor + 1;

    // Add the new entry
    this._stack.push(entry);
    this._entryBytes.push(estimateSceneBytes(entry.scene));
    this._cursor = this._stack.length - 1;
    this._lastPushedScene = scene;

    // T2-82: evict by either count OR byte budget. Always retain at
    // least one entry — eviction stops when the stack would drop to
    // a single entry, even if that one entry is over budget.
    let evictedCount = 0;
    let evictedBytes = 0;
    while (
      this._stack.length > 1 &&
      (this._stack.length > this._maxSize || this._totalBytesUnsafe() > this._maxBytes)
    ) {
      this._stack.shift();
      const removed = this._entryBytes.shift() ?? 0;
      this._cursor--;
      evictedCount++;
      evictedBytes += removed;
    }
    if (evictedBytes > 0 && evictedCount > 0) {
      console.warn(
        `[HistoryManager] T2-82: evicted ${evictedCount} entr${evictedCount === 1 ? 'y' : 'ies'} ` +
        `(~${(evictedBytes / 1024 / 1024).toFixed(1)} MB) to stay under ` +
        `${(this._maxBytes / 1024 / 1024).toFixed(0)}MB / ${this._maxSize} entries.`,
      );
    }

    this._notify();
  }

  private _totalBytesUnsafe(): number {
    let total = 0;
    for (const n of this._entryBytes) total += n;
    return total;
  }

  /**
   * T2-82: approximate bytes used by all entries currently in the
   * stack. Computed from the cached per-entry estimates; constant-
   * time per entry. Useful for tests and debug overlays.
   */
  totalBytes(): number {
    return this._totalBytesUnsafe();
  }

  /**
   * Undo: move cursor back one step.
   * Returns the previous Scene, or null if at the beginning.
   */
  undo(): Scene | null {
    const entry = this.undoEntry();
    return entry === null ? null : entry.scene;
  }

  /**
   * T2-78: undo with metadata. Returns the entry now at the cursor
   * (i.e. the scene the caller should apply), or null if undo wasn't
   * possible. Use this when restoring selection or naming the action
   * in UI; otherwise {@link undo} is the simpler API.
   */
  undoEntry(): HistoryEntry | null {
    if (!this.canUndo()) return null;

    this._cursor--;
    this._notify();
    return this._stack[this._cursor];
  }

  /**
   * Redo: move cursor forward one step.
   * Returns the next Scene, or null if at the end.
   */
  redo(): Scene | null {
    const entry = this.redoEntry();
    return entry === null ? null : entry.scene;
  }

  /**
   * T2-78: redo with metadata. Returns the entry now at the cursor,
   * or null if redo wasn't possible. See {@link undoEntry}.
   */
  redoEntry(): HistoryEntry | null {
    if (!this.canRedo()) return null;

    this._cursor++;
    this._notify();
    return this._stack[this._cursor];
  }

  /**
   * Clear all history and start fresh with an initial scene.
   */
  reset(initialScene: Scene, meta?: HistoryEntryMeta): void {
    const entry = buildEntry(initialScene, meta);
    this._stack = [entry];
    this._entryBytes = [estimateSceneBytes(entry.scene)];
    this._cursor = 0;
    this._lastPushedScene = initialScene;
    this._notify();
  }

  /**
   * Clear all history entirely.
   */
  clear(): void {
    this._stack = [];
    this._entryBytes = [];
    this._cursor = -1;
    this._lastPushedScene = null;
    this._notify();
  }

  // ─── EVENTS ──────────────────────────────────────────────────

  /**
   * Subscribe to history state changes (undo/redo availability).
   * Returns an unsubscribe function.
   */
  onChange(callback: HistoryChangeCallback): () => void {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  private _notify(): void {
    const state = this.getState();
    for (const cb of this._listeners) {
      cb(state);
    }
  }
}

