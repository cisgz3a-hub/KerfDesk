// useShortcuts — window-level keyboard handlers covering F-A15's File, Edit,
// Transform, and View categories. Each category's matchers live in
// ./shortcuts.ts. This hook wires the active store actions + platform adapter
// into those matchers.
//
// Split into two child hooks (file+edit / transform+view) so each fits
// under the 80-line per-function lint cap. Both register their own
// window keydown listener; order doesn't matter because the matchers
// guard themselves (modifier checks, isEditableTarget, kind-of-event).

import { useEffect } from 'react';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { usePlatform } from './platform-context';
import {
  handleEditShortcut,
  handleFileShortcut,
  handleTransformShortcut,
  handleViewShortcut,
} from './shortcuts';

// F-A13 dirty check. Lives outside the hook so it doesn't reread state at
// useEffect-rebuild time — it queries the current store imperatively when
// the keyboard event fires.
function confirmDiscard(action: string): boolean {
  const s = useStore.getState();
  if (!s.dirty) return true;
  const name = s.savedName ?? 'this project';
  return window.confirm(
    `Discard unsaved changes to ${name} and ${action}? (Cancel to keep editing — Save first via Save or Ctrl+S.)`,
  );
}

export function useShortcuts(): void {
  useFileEditShortcuts();
  useTransformViewShortcuts();
}

function useFileEditShortcuts(): void {
  const platform = usePlatform();
  const project = useStore((s) => s.project);
  const jobPlacement = useStore((s) => s.jobPlacement);
  const importSvgObject = useStore((s) => s.importSvgObject);
  const setProject = useStore((s) => s.setProject);
  const newProject = useStore((s) => s.newProject);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const removeSceneObject = useStore((s) => s.removeSceneObject);
  const selectObject = useStore((s) => s.selectObject);
  const selectAllObjects = useStore((s) => s.selectAllObjects);
  const duplicateSelection = useStore((s) => s.duplicateSelection);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const savedName = useStore((s) => s.savedName);
  const lastSaveTarget = useStore((s) => s.lastSaveTarget);
  const markSaved = useStore((s) => s.markSaved);
  const markLoaded = useStore((s) => s.markLoaded);
  const statusReport = useLaserStore((s) => s.statusReport);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const pushToast = useToastStore((s) => s.pushToast);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isModalOpen(useUiStore.getState())) return;
      const machine = { statusReport, workOriginActive, wcoCache };
      // prettier-ignore
      const fileCtx = { platform, project, jobPlacement, machine, importSvgObject, setProject, newProject, savedName, lastSaveTarget, markSaved, markLoaded, pushToast, confirmDiscard };
      // prettier-ignore
      const editCtx = { undo, redo, selectedObjectId, additionalSelectedIds, removeSceneObject, selectObject, selectAllObjects, duplicateSelection };
      if (handleFileShortcut(e, fileCtx)) return;
      handleEditShortcut(e, editCtx);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    platform,
    project,
    jobPlacement,
    importSvgObject,
    setProject,
    newProject,
    savedName,
    lastSaveTarget,
    markSaved,
    markLoaded,
    statusReport,
    workOriginActive,
    wcoCache,
    pushToast,
    undo,
    redo,
    selectedObjectId,
    additionalSelectedIds,
    removeSceneObject,
    selectObject,
    selectAllObjects,
    duplicateSelection,
  ]);
}

function useTransformViewShortcuts(): void {
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const applyObjectTransform = useStore((s) => s.applyObjectTransform);
  const togglePreview = useStore((s) => s.togglePreview);
  const fitToSelection = useStore((s) => s.fitToSelection);
  const resetView = useUiStore((s) => s.resetView);
  const zoomBy = useUiStore((s) => s.zoomBy);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isModalOpen(useUiStore.getState())) return;
      if (handleTransformShortcut(e, { project, selectedObjectId, applyObjectTransform })) return;
      handleViewShortcut(e, { togglePreview, resetView, zoomBy, fitToSelection });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    project,
    selectedObjectId,
    applyObjectTransform,
    togglePreview,
    resetView,
    zoomBy,
    fitToSelection,
  ]);
}
