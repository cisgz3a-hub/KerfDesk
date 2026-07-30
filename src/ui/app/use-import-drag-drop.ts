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
import { importImageFile } from '../commands/import-image-action';
import { importDxfFiles, isDxfFile } from './dxf-import-action';
import { isGcodeFile, openGcodeFileInInspector } from './gcode-open-action';
import { importStlFiles, isStlFile } from './stl-import-action';
import { useStore } from '../state';
import type { ImportOutcome } from '../state/store';
import { useToastStore, type ToastVariant } from '../state/toast-store';
import type { GcodeInspectionSource } from '../gcode-inspector';
import { useUiStore } from '../state/ui-store';
import { importSvgFiles } from './svg-import-action';

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

type DropImportActions = {
  readonly importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome;
  readonly importRasterImage: (object: SceneObject, batchIdx?: number) => void;
  readonly openGcodeInspector: (name: string, source: GcodeInspectionSource) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

function routeDroppedFiles(dt: DataTransfer, actions: DropImportActions): void {
  const svgFiles = pickSvgFiles(dt);
  const imageFiles = pickImageFiles(dt);
  const stlFiles = [...dt.files].filter(isStlFile);
  const dxfFiles = [...dt.files].filter(isDxfFile);
  const gcodeFiles = [...dt.files].filter(isGcodeFile);
  const recognized =
    svgFiles.length + imageFiles.length + stlFiles.length + dxfFiles.length + gcodeFiles.length;
  const ignored = dt.files.length - recognized;
  if (dt.files.length > 0 && recognized === 0) {
    actions.pushToast(
      'Drop ignored — no SVG, DXF, image (PNG/JPG), STL, or G-code files in the selection',
      'warning',
    );
    return;
  }
  // Mixed drops used to discard non-SVG files SILENTLY (M26) — name them.
  if (ignored > 0) {
    actions.pushToast(
      `Ignored ${ignored} file(s) — only SVG, DXF, PNG, JPG, STL, and G-code import`,
      'warning',
    );
  }
  const firstGcodeFile = gcodeFiles[0];
  if (firstGcodeFile !== undefined) {
    void openGcodeFileInInspector(firstGcodeFile, actions.openGcodeInspector, actions.pushToast);
  }
  if (gcodeFiles.length > 1) {
    const additionalNames = gcodeFiles.slice(1).map((file) => file.name);
    actions.pushToast(
      `Ignored ${additionalNames.length} additional G-code files: ${additionalNames.join(', ')}`,
      'warning',
    );
  }
  void importSvgFiles(svgFiles, actions.importSvgObject, actions.pushToast);
  // H.6a: DXF → imported vector (both machine modes).
  void importDxfFiles(dxfFiles, {
    importObject: actions.importSvgObject,
    pushToast: actions.pushToast,
  });
  void importImagesInOrder(imageFiles, actions.importRasterImage, actions.pushToast);
  // H.4: STL → relief (CNC mode only; the action toasts the laser-mode case).
  void importStlFiles(stlFiles, {
    project: useStore.getState().project,
    importObject: actions.importSvgObject,
    pushToast: actions.pushToast,
  });
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
