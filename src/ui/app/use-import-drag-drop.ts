// useImportDragDrop — window-level drag-and-drop import (F-A3 / F-F2).
// Extracted from App so the App component body stays under the function-size
// limit.
//
// Files route through the same ordered dispatcher as the unified picker. This
// preserves the original FileList order across formats and gives every
// successful artwork import one shared stagger index.
//   * useUiStoreFlag — drives the F-A3 dragenter overlay via the
//     toast-store-adjacent UI store; counts enter/leave nesting because the
//     browser fires dragenter/leave on every nested element.
//   * A dropped project (.lf2, .lbrn, .lbrn2) opens like one the operating
//     system hands over instead (ADR-378 Amendment 1).

import { useEffect, useRef } from 'react';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import type { GcodeInspectionSource } from '../gcode-inspector';
import { appProjectOpenDeps, openDroppedProject } from '../recent-projects/dropped-project-open';
import { useUiStore } from '../state/ui-store';
import { dispatchImportFilesInOrder } from './import-dispatch';
import { usePlatformOptional } from './platform-context';

export function useImportDragDrop(
  openGcodeInspector: (name: string, source: GcodeInspectionSource) => void,
): void {
  const importSvgFragment = useStore((s) => s.importSvgFragment);
  const importSvgObject = useStore((s) => s.importSvgObject);
  const importRasterImage = useStore((s) => s.importRasterImage);
  const pushToast = useToastStore((s) => s.pushToast);
  const setDragOverlay = useUiStore((s) => s.setDragOverlay);
  const platform = usePlatformOptional();
  // useUiStore was originally useDragOverlay — the rename is mechanical;
  // the action names below didn't change.
  // Browsers fire dragenter/leave once per nested element, so a naive
  // toggle flickers when the cursor crosses child boundaries. Counting
  // nesting depth is the standard fix.
  const depth = useRef(0);

  useEffect(() => {
    const onDragEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      if (depth.current === 1) setDragOverlay(true);
    };
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragOverlay(false);
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      depth.current = 0;
      setDragOverlay(false);
      if (e.dataTransfer === null) return;
      routeDroppedFiles(e.dataTransfer, platform, {
        getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
        importSvgObject,
        importSvgFragment,
        importRasterImage,
        openGcodeInspector,
        pushToast,
      });
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [
    importSvgFragment,
    importSvgObject,
    importRasterImage,
    openGcodeInspector,
    platform,
    pushToast,
    setDragOverlay,
  ]);
}

type DropImportActions = Parameters<typeof dispatchImportFilesInOrder>[1] & {
  readonly openGcodeInspector: (name: string, source: GcodeInspectionSource) => void;
};

function routeDroppedFiles(
  dt: DataTransfer,
  platform: PlatformAdapter | null,
  actions: DropImportActions,
): void {
  const files = [...dt.files];
  if (platform !== null && openDroppedProject(files, appProjectOpenDeps(platform))) return;
  void dispatchImportFilesInOrder(files, actions, { sourceLabel: 'Drop' });
}

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false;
}
