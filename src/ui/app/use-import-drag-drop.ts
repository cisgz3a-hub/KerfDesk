// useImportDragDrop — window-level drag-and-drop import (F-A3 / F-F2).
// Extracted from App so the App component body stays under the function-size
// limit.
//
// Concerns split into pure helpers so this hook stays a thin listener:
//   * importMany — parse + import an SVG file list (no DOM).
//   * pickSvgFiles / pickImageFiles — sort a DataTransfer's files by kind.
//     PNG/JPG drops route through the same pipeline as the Import Image
//     button (M26, AUDIT-2026-06-10 — drag-drop is F-F2's primary entry and
//     used to be SVG-extension-only).
//   * useUiStoreFlag — drives the F-A3 dragenter overlay via the
//     toast-store-adjacent UI store; counts enter/leave nesting because the
//     browser fires dragenter/leave on every nested element.

import { useEffect, useRef } from 'react';
import type { SceneObject } from '../../core/scene';
import { parseSvg } from '../../io/svg';
import { importImageFile } from '../commands/import-image-action';
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
      const svgFiles = pickSvgFiles(e.dataTransfer);
      const imageFiles = pickImageFiles(e.dataTransfer);
      const ignored = e.dataTransfer.files.length - svgFiles.length - imageFiles.length;
      if (e.dataTransfer.files.length > 0 && svgFiles.length === 0 && imageFiles.length === 0) {
        pushToast('Drop ignored — no SVG or image (PNG/JPG) files in the selection', 'warning');
        return;
      }
      // Mixed drops used to discard non-SVG files SILENTLY (M26) — name them.
      if (ignored > 0) {
        pushToast(`Ignored ${ignored} file(s) — only SVG, PNG, and JPG import`, 'warning');
      }
      void importMany(svgFiles, importSvgObject, pushToast);
      void importImagesInOrder(imageFiles, importRasterImage, pushToast);
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
  }, [importSvgObject, importRasterImage, pushToast, setDragOverlay]);
}

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false;
}

function pickSvgFiles(dt: DataTransfer): ReadonlyArray<File> {
  return [...dt.files].filter((f) => f.name.toLowerCase().endsWith('.svg'));
}

// MIME type OR extension: drops from browsers carry types, drops from some
// file managers don't. A renamed non-image fails the decode in
// importImageFile and surfaces as a per-file error toast.
function pickImageFiles(dt: DataTransfer): ReadonlyArray<File> {
  return [...dt.files].filter((f) => {
    if (f.type === 'image/png' || f.type === 'image/jpeg') return true;
    const name = f.name.toLowerCase();
    return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg');
  });
}

// Sequenced (not fire-and-forget) so the Nth image lands at the F-A3 10 mm
// stagger offset N and z-order/selection follow drop order — the image arm
// previously fired each import with no index, stacking every drop pixel-exactly
// at bed centre with selection landing on whichever decode finished last.
async function importImagesInOrder(
  files: ReadonlyArray<File>,
  importRasterImage: (object: SceneObject, batchIdx?: number) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  let batchIdx = 0;
  for (const file of files) {
    const idx = batchIdx;
    await importImageFile(file, (obj) => importRasterImage(obj, idx), pushToast);
    batchIdx += 1;
  }
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
