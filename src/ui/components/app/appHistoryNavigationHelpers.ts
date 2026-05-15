import type { Scene } from '../../../core/scene/Scene';
import type { HistoryEntry } from '../../history/HistoryManager';
import { filterValidIds } from './appSelectionHelpers';

export interface HistoryNavigationCommit {
  scene: Scene;
  direction: 'undo' | 'redo';
  selectionAfter: ReadonlySet<string>;
}

/**
 * T2-6 Phase 3ag: pure history navigation transaction builder.
 * App.tsx still owns the job-running safety gate and history-store pop;
 * this helper owns the target scene + stale-selection filtering policy.
 */
export function buildHistoryNavigationCommit(
  entry: HistoryEntry,
  direction: 'undo' | 'redo',
): HistoryNavigationCommit {
  return {
    scene: entry.scene,
    direction,
    selectionAfter: filterValidIds(entry.selectionAfter, entry.scene),
  };
}
