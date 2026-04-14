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

// ─── TYPES ───────────────────────────────────────────────────────

export type HistoryChangeCallback = (state: HistoryState) => void;

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;     // How many undos are available
  redoDepth: number;     // How many redos are available
  totalSnapshots: number;
}

// ─── HISTORY MANAGER ─────────────────────────────────────────────

export class HistoryManager {
  private _stack: Scene[] = [];
  private _cursor = -1;            // Index of current snapshot
  private _maxSize: number;
  private _listeners = new Set<HistoryChangeCallback>();

  constructor(maxSize: number = 100) {
    this._maxSize = Math.max(1, maxSize);
  }

  // ─── CURRENT STATE ───────────────────────────────────────────

  /** The current Scene, or null if history is empty. */
  getCurrent(): Scene | null {
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
  push(scene: Scene): void {
    const snapshot = scene;

    // Skip if identical to current snapshot (prevents duplicate entries
    // from no-op commits like mouseUp without movement)
    if (this._cursor >= 0 && this._stack[this._cursor] === snapshot) return;

    // Truncate redo history — everything after cursor is discarded
    this._stack.length = this._cursor + 1;

    // Add the new snapshot
    this._stack.push(snapshot);
    this._cursor = this._stack.length - 1;

    // Enforce max size — evict from the front
    while (this._stack.length > this._maxSize) {
      this._stack.shift();
      this._cursor--;
    }

    this._notify();
  }

  /**
   * Undo: move cursor back one step.
   * Returns the previous Scene, or null if at the beginning.
   */
  undo(): Scene | null {
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
    if (!this.canRedo()) return null;

    this._cursor++;
    this._notify();
    return this._stack[this._cursor];
  }

  /**
   * Clear all history and start fresh with an initial scene.
   */
  reset(initialScene: Scene): void {
    this._stack = [initialScene];
    this._cursor = 0;
    this._notify();
  }

  /**
   * Clear all history entirely.
   */
  clear(): void {
    this._stack = [];
    this._cursor = -1;
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

