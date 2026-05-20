import { useMemo, type RefObject } from 'react';
import { type ViewportActions } from '../components/CanvasViewport';
import { type ToolType } from '../components/ToolBar';
import { gatedFeature } from '../utils/proGate';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

interface KeyboardSceneOperations {
  readonly performBoolean: (op: 'union' | 'subtract' | 'intersect') => Promise<void>;
  readonly centerOnMaterial: () => void;
}

interface UseAppKeyboardWorkflowParams {
  readonly handleUndo: () => void;
  readonly handleRedo: () => void;
  readonly handleKeyboardSave: () => Promise<void>;
  readonly handleKeyboardOpen: () => void;
  readonly handleKeyboardNew: () => Promise<void>;
  readonly handleSelectAll: () => void;
  readonly handleDelete: () => void;
  readonly handleCopy: () => void;
  readonly handlePaste: () => void;
  readonly handleDuplicate: () => void;
  readonly handleClearSelection: () => void;
  readonly handleNudge: (dx: number, dy: number, commit: boolean) => void;
  readonly handleGridArray: () => void;
  readonly handleTogglePreview: () => void;
  readonly viewportActionsRef: RefObject<ViewportActions | null>;
  readonly setActiveTool: (tool: ToolType) => void;
  readonly setShowShortcuts: (updater: boolean | ((value: boolean) => boolean)) => void;
  readonly selectedIds: ReadonlySet<string>;
  readonly clipboardItemCount: number;
  readonly sceneOps: KeyboardSceneOperations;
}

export function runBooleanKeyboardShortcut(
  sceneOps: Pick<KeyboardSceneOperations, 'performBoolean'>,
  op: 'union' | 'subtract' | 'intersect',
): void {
  if (!gatedFeature('boolean_ops')) return;
  void sceneOps.performBoolean(op).catch(error => {
    console.error('[LaserForge] Boolean keyboard shortcut failed', error);
  });
}

export function useAppKeyboardWorkflow({
  handleUndo,
  handleRedo,
  handleKeyboardSave,
  handleKeyboardOpen,
  handleKeyboardNew,
  handleSelectAll,
  handleDelete,
  handleCopy,
  handlePaste,
  handleDuplicate,
  handleClearSelection,
  handleNudge,
  handleGridArray,
  handleTogglePreview,
  viewportActionsRef,
  setActiveTool,
  setShowShortcuts,
  selectedIds,
  clipboardItemCount,
  sceneOps,
}: UseAppKeyboardWorkflowParams) {
  useKeyboardShortcuts(
    useMemo(
      () => ({
        onUndo: handleUndo,
        onRedo: handleRedo,
        onSave: () => void handleKeyboardSave(),
        onOpen: handleKeyboardOpen,
        onNew: () => void handleKeyboardNew(),
        onSelectAll: handleSelectAll,
        onDelete: handleDelete,
        onCopy: handleCopy,
        onPaste: handlePaste,
        onDuplicate: handleDuplicate,
        onEscape: () => {
          handleClearSelection();
          setActiveTool('select');
        },
        onZoomIn: () => viewportActionsRef.current?.zoomIn(),
        onZoomOut: () => viewportActionsRef.current?.zoomOut(),
        onZoomFit: () => viewportActionsRef.current?.fitToBed(),
        onToolSelect: () => setActiveTool('select'),
        onToolRect: () => setActiveTool('rect'),
        onToolEllipse: () => setActiveTool('ellipse'),
        onToolLine: () => setActiveTool('line'),
        onToolText: () => setActiveTool('text'),
        onToolNode: () => setActiveTool('node'),
        onToolPan: () => {},
        onToggleToolpath: () => {
          handleTogglePreview();
        },
        onToggleShortcuts: () => setShowShortcuts(s => !s),
        onNudge: handleNudge,
        selectionCount: selectedIds.size,
        clipboardItemCount,
        onBooleanUnion: () => runBooleanKeyboardShortcut(sceneOps, 'union'),
        onBooleanSubtract: () => runBooleanKeyboardShortcut(sceneOps, 'subtract'),
        onBooleanIntersect: () => runBooleanKeyboardShortcut(sceneOps, 'intersect'),
        onAlignSelectionCenter: () => {
          if (selectedIds.size === 0) return;
          sceneOps.centerOnMaterial();
        },
        onGridArray: handleGridArray,
      }),
      [
        handleUndo,
        handleRedo,
        handleKeyboardSave,
        handleKeyboardOpen,
        handleKeyboardNew,
        handleSelectAll,
        handleDelete,
        handleCopy,
        handlePaste,
        handleDuplicate,
        handleClearSelection,
        handleNudge,
        sceneOps,
        handleGridArray,
        handleTogglePreview,
        selectedIds,
        clipboardItemCount,
        setActiveTool,
        setShowShortcuts,
        viewportActionsRef,
      ],
    ),
  );
}
