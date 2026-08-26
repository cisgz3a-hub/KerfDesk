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

import { useEffect, useRef } from 'react';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import type { GcodeInspectionSource } from '../gcode-inspector';
import { useUiStore } from '../state/ui-store';
import { dispatchImportFilesInOrder } from './import-dispatch';

export function useImportDragDrop(
  openGcodeInspector: (name: string, source: GcodeInspectionSource) => void,
): void {
  const importSvgObject = useStore((s) => s.importSvgObject);
  const importRasterImage = useStore((s) => s.importRasterImage);
  const pushToast = useToastStore((s) => s.pushToast);
  const setDragOverlay = useUiStore((s) => s.setDragOverlay);
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
      routeDroppedFiles(e.dataTransfer, {
        project: useStore.getState().project,
        importSvgObject,
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
  }, [importSvgObject, importRasterImage, openGcodeInspector, pushToast, setDragOverlay]);
}

type DropImportActions = Parameters<typeof dispatchImportFilesInOrder>[1] & {
  readonly openGcodeInspector: (name: string, source: GcodeInspectionSource) => void;
};

function routeDroppedFiles(dt: DataTransfer, actions: DropImportActions): void {
  void dispatchImportFilesInOrder([...dt.files], actions, { sourceLabel: 'Drop' });
}

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false;
}
