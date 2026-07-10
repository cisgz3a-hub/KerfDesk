// useOutputScope — a value-stable OutputScope from the store's four primitive
// scope fields. Subscribing to currentOutputScope(s) directly returns a FRESH
// object (and array) on every store update, so zustand 4.5's Object.is selector
// equality fails on unrelated changes (e.g. a hover setCursorMm) and consumers
// re-render + recompute. This memoizes on the primitives so the reference is
// stable across mousemoves and changes only on a real selection/scope change.
//
// (Extracted from the inline pattern in use-preview-toolpath.ts per CLAUDE.md's
// extract-on-second-use rule; PRF-01/PRF-03 consume it.)

import { useMemo } from 'react';
import type { OutputScope } from '../../core/scene';
import { useStore } from './store';

export function useOutputScope(): OutputScope {
  const cutSelectedGraphics = useStore((s) => s.outputScopeSettings.cutSelectedGraphics);
  const useSelectionOrigin = useStore((s) => s.outputScopeSettings.useSelectionOrigin);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  return useMemo(
    () => ({
      cutSelectedGraphics,
      useSelectionOrigin,
      selectedObjectIds: [
        ...(selectedObjectId === null ? [] : [selectedObjectId]),
        ...additionalSelectedIds,
      ],
    }),
    [additionalSelectedIds, cutSelectedGraphics, selectedObjectId, useSelectionOrigin],
  );
}
