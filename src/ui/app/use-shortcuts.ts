// useShortcuts — window-level keyboard handlers covering F-A15's File, Edit,
// Transform, and View categories. Each category's matchers live in
// ./shortcuts.ts. This hook wires the active store actions + platform adapter
// into those matchers.

import { useEffect } from 'react';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
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
  const platform = usePlatform();
  const project = useStore((s) => s.project);
  const importSvgObject = useStore((s) => s.importSvgObject);
  const setProject = useStore((s) => s.setProject);
  const newProject = useStore((s) => s.newProject);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const removeSceneObject = useStore((s) => s.removeSceneObject);
  const selectObject = useStore((s) => s.selectObject);
  const selectAllObjects = useStore((s) => s.selectAllObjects);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const togglePreview = useStore((s) => s.togglePreview);
  const applyObjectTransform = useStore((s) => s.applyObjectTransform);
  const savedName = useStore((s) => s.savedName);
  const lastSaveTarget = useStore((s) => s.lastSaveTarget);
  const markSaved = useStore((s) => s.markSaved);
  const markLoaded = useStore((s) => s.markLoaded);
  const pushToast = useToastStore((s) => s.pushToast);
  const resetView = useUiStore((s) => s.resetView);
  const zoomBy = useUiStore((s) => s.zoomBy);

  useEffect(() => {
    const fileCtx = {
      platform,
      project,
      importSvgObject,
      setProject,
      newProject,
      savedName,
      lastSaveTarget,
      markSaved,
      markLoaded,
      pushToast,
      confirmDiscard,
    };
    const editCtx = {
      undo,
      redo,
      selectedObjectId,
      additionalSelectedIds,
      removeSceneObject,
      selectObject,
      selectAllObjects,
    };
    const transformCtx = { project, selectedObjectId, applyObjectTransform };
    const viewCtx = { togglePreview, resetView, zoomBy };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (handleFileShortcut(e, fileCtx)) return;
      if (handleEditShortcut(e, editCtx)) return;
      if (handleTransformShortcut(e, transformCtx)) return;
      handleViewShortcut(e, viewCtx);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    platform,
    project,
    importSvgObject,
    setProject,
    newProject,
    selectedObjectId,
    removeSceneObject,
    selectObject,
    undo,
    redo,
    togglePreview,
    applyObjectTransform,
    savedName,
    lastSaveTarget,
    markSaved,
    markLoaded,
    pushToast,
    resetView,
    zoomBy,
    additionalSelectedIds,
    selectAllObjects,
  ]);
}
