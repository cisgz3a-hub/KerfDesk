// useShortcuts — window-level keyboard handlers covering F-A15's File, Edit,
// Transform, and View categories. Each category's matchers live in
// ./shortcuts.ts. This hook wires the active store actions + platform adapter
// into those matchers.
//
// Split into two child hooks (file+edit / transform+view) so each fits
// under the 80-line per-function lint cap. Both register their own
// window keydown listener; order doesn't matter because the matchers
// guard themselves (modifier checks, isEditableTarget, kind-of-event).

import { useEffect, useRef } from 'react';
import { selectedConvertibleVectors, selectedObjectIds } from '../commands/selection-command-state';
import { currentOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { confirmDiscardAsync } from './confirm-discard';
import { usePlatform } from './platform-context';
import { toggleWorkspaceSidePanels } from './workspace-panel-actions';
import {
  type EditCtx,
  type FileCtx,
  handleEditShortcut,
  handleFileShortcut,
  handleToolShortcut,
  handleTransformShortcut,
  handleViewShortcut,
  type ToolCtx,
} from './shortcuts';

type FileEditShortcutBindings = {
  readonly fileCtx: FileCtx;
  readonly editCtx: EditCtx;
  readonly toolCtx: ToolCtx;
};

export function useShortcuts(): void {
  useFileEditShortcuts();
  useTransformViewShortcuts();
}

function useFileEditShortcuts(): void {
  const platform = usePlatform();
  const project = useStore((s) => s.project);
  const jobPlacement = useStore((s) => s.jobPlacement);
  const outputScope = useStore((s) => currentOutputScope(s));
  const importSvgObject = useStore((s) => s.importSvgObject);
  const setProject = useStore((s) => s.setProject);
  const newProject = useStore((s) => s.newProject);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const selectedPathNode = useStore((s) => s.selectedPathNode);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const removeSceneObjects = useStore((s) => s.removeSceneObjects);
  const deleteSelectedPathNodes = useStore((s) => s.deleteSelectedPathNodes);
  const selectObject = useStore((s) => s.selectObject);
  const selectAllObjects = useStore((s) => s.selectAllObjects);
  const copySelection = useStore((s) => s.copySelection);
  const cutSelection = useStore((s) => s.cutSelection);
  const pasteClipboard = useStore((s) => s.pasteClipboard);
  const groupSelection = useStore((s) => s.groupSelection);
  const ungroupSelection = useStore((s) => s.ungroupSelection);
  const duplicateSelection = useStore((s) => s.duplicateSelection);
  const resetToolMode = useUiStore((s) => s.resetToolMode);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const savedName = useStore((s) => s.savedName);
  const lastSaveTarget = useStore((s) => s.lastSaveTarget);
  const markSaved = useStore((s) => s.markSaved);
  const markLoaded = useStore((s) => s.markLoaded);
  const advanceVariablesAfter = useStore((s) => s.advanceVariablesAfter);
  const statusReport = useLaserStore((s) => s.statusReport);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const pushToast = useToastStore((s) => s.pushToast);
  const machine = { statusReport, workOriginActive, wcoCache };
  const confirmDiscard = (action: string): Promise<boolean> =>
    confirmDiscardAsync(platform, action);
  // prettier-ignore
  const fileCtx: FileCtx = { platform, project, jobPlacement, outputScope, machine, controllerSettings, importSvgObject, setProject, newProject, savedName, lastSaveTarget, markSaved, markLoaded, advanceVariablesAfter, pushToast, confirmDiscard };
  // prettier-ignore
  const editCtx: EditCtx = { undo, redo, selectedObjectId, selectedPathNode, additionalSelectedIds, removeSceneObjects, deleteSelectedPathNodes, selectObject, selectAllObjects, copySelection, cutSelection, pasteClipboard, groupSelection, ungroupSelection, duplicateSelection, resetToolMode };
  useFileEditShortcutEffect(fileCtx, editCtx, { setToolMode, openConvertToBitmap });
}

// Ctrl/Cmd+Shift+B (LightBurn's Convert to Bitmap binding). Same gate as the
// Tools command: every selected object is a convertible vector — otherwise
// the chord is a no-op, mirroring the disabled menu item. State is read at
// call time so the handler never closes over a stale selection.
function openConvertToBitmap(): void {
  const s = useStore.getState();
  const ids = selectedObjectIds(s.selectedObjectId, s.additionalSelectedIds);
  if (selectedConvertibleVectors(s.project, ids).length === 0) return;
  useUiStore.getState().openConvertBitmapDialog();
}

function useFileEditShortcutEffect(fileCtx: FileCtx, editCtx: EditCtx, toolCtx: ToolCtx): void {
  const bindingsRef = useRef<FileEditShortcutBindings>({ fileCtx, editCtx, toolCtx });
  bindingsRef.current = { fileCtx, editCtx, toolCtx };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isModalOpen(useUiStore.getState())) return;
      const { fileCtx, editCtx, toolCtx } = bindingsRef.current;
      if (handleFileShortcut(e, fileCtx)) return;
      if (handleToolShortcut(e, toolCtx)) return;
      handleEditShortcut(e, editCtx);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function useTransformViewShortcuts(): void {
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const selectedPathNode = useStore((s) => s.selectedPathNode);
  const applyObjectTransform = useStore((s) => s.applyObjectTransform);
  const nudgeSelection = useStore((s) => s.nudgeSelection);
  const nudgeSelectedPathNode = useStore((s) => s.nudgeSelectedPathNode);
  const flipSelection = useStore((s) => s.flipSelection);
  const togglePreview = useStore((s) => s.togglePreview);
  const fitToSelection = useStore((s) => s.fitToSelection);
  const resetView = useUiStore((s) => s.resetView);
  const zoomBy = useUiStore((s) => s.zoomBy);
  const toggleSidePanels = (): void => {
    const streamer = useLaserStore.getState().streamer;
    if (
      streamer !== null &&
      ['streaming', 'paused', 'done', 'errored', 'tool-change'].includes(streamer.status)
    )
      return;
    toggleWorkspaceSidePanels(useUiStore.getState());
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isModalOpen(useUiStore.getState())) return;
      if (
        handleTransformShortcut(e, {
          project,
          selectedObjectId,
          selectedPathNode,
          applyObjectTransform,
          nudgeSelection,
          nudgeSelectedPathNode,
          flipSelection,
        })
      )
        return;
      handleViewShortcut(e, {
        togglePreview,
        resetView,
        zoomBy,
        fitToSelection,
        toggleSidePanels,
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    project,
    selectedObjectId,
    selectedPathNode,
    applyObjectTransform,
    nudgeSelection,
    nudgeSelectedPathNode,
    flipSelection,
    togglePreview,
    resetView,
    zoomBy,
    fitToSelection,
  ]);
}
