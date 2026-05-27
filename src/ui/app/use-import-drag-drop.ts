// useImportDragDrop — window-level drag-and-drop SVG import (F-A3). Extracted
// from App so the App component body stays under the function-size limit.
//
// Three concerns split into pure helpers so this hook stays a thin listener:
//   * importMany — parse + import a file list (no DOM).
//   * useUiStoreFlag — drives the F-A3 dragenter overlay via the
//     toast-store-adjacent UI store; counts enter/leave nesting because the
//     browser fires dragenter/leave on every nested element.
//   * pickSvgFiles — pulls .svg files out of a DataTransfer.

import { useEffect, useRef } from 'react';
import type { SceneObject } from '../../core/scene';
import { parseSvg } from '../../io/svg';
import { useStore } from '../state';
import type { ImportOutcome } from '../state/store';
import { useToastStore, type ToastVariant } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import {
  describeImportError,
  describeImportResult,
  describeReimportOutcome,
} from './import-toasts';

export function useImportDragDrop(): void {
  const importSvgObject = useStore((s) => s.importSvgObject);
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
      const files = pickSvgFiles(e.dataTransfer);
      if (e.dataTransfer.files.length > 0 && files.length === 0) {
        pushToast('Drop ignored — no SVG files in the selection', 'warning');
        return;
      }
      void importMany(files, importSvgObject, pushToast);
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
  }, [importSvgObject, pushToast, setDragOverlay]);
}

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false;
}

function pickSvgFiles(dt: DataTransfer): ReadonlyArray<File> {
  return [...dt.files].filter((f) => f.name.toLowerCase().endsWith('.svg'));
}

async function importMany(
  files: ReadonlyArray<File>,
  importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  let successIdx = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      const id = crypto.randomUUID();
      const result = parseSvg({ svgText: text, id, source: file.name });
      if (result.object !== null) {
        const outcome = importSvgObject(result.object, successIdx);
        successIdx += 1;
        if (outcome.kind === 'replaced') {
          const t = describeReimportOutcome(outcome);
          pushToast(t.message, t.variant);
          continue;
        }
      }
      for (const t of describeImportResult(file.name, result)) {
        pushToast(t.message, t.variant);
      }
    } catch (err) {
      const t = describeImportError(file.name, err);
      pushToast(t.message, t.variant);
      console.error(`Failed to import ${file.name}:`, err);
    }
  }
}
