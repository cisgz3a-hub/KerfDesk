// Root App component. Wires Toolbar (top) + Workspace (center) +
// CutsLayersPanel (right) + StatusBar (bottom). Window-level drag-drop import
// and keyboard shortcuts live in dedicated hooks so this component stays a
// thin layout shell.

import { ConfirmSaveDialog, StatusBar, Toasts } from '../common';
import { CommandShell } from '../commands';
import { LiveMotionBar, useJobShortcuts } from '../laser';
import { BoardCapturePanel } from '../laser/board-capture';
import { JobReviewDialog } from '../laser/job-review';
import { AddTextDialog } from '../text/AddTextDialog';
import { DesignLibraryDialog } from '../library/DesignLibraryDialog';
import { ImportImageDialog } from '../trace/ImportImageDialog';
import { CameraPanel, WorkspaceCameraOverlay } from '../camera';
import { Cnc3DPane, RegistrationJigPanel, ToolStrip, Workspace } from '../workspace';
import { PwaUpdatePromptGate } from './PwaUpdatePromptGate';
import { useAutosave, useAutosaveRecovery } from './use-autosave';
import { useActiveJobWakeLock } from './use-active-job-wake-lock';
import { useCncLibraryPersistence } from './use-cnc-library-persistence';
import { useCompactRailDefaults } from './use-compact-rail-defaults';
import { useGlobalErrorHandlers } from './use-global-error-handlers';
import { useImportDragDrop } from './use-import-drag-drop';
import { useJobCheckpoint } from './use-job-checkpoint';
import { useLayerDefaultsPersistence } from './use-layer-defaults-persistence';
import { useMaterialLibraryPersistence } from './use-material-library-persistence';
import { usePolylineFairingUpgrade } from './use-polyline-fairing-upgrade';
import { useShortcuts } from './use-shortcuts';
import { useSingleArtworkSelection } from './use-single-artwork-selection';
import { useSpacePan } from './use-space-pan';
import { useUnloadStop } from './use-unload-stop';
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard';
import { useWindowTitle } from './use-window-title';
import { WorkspaceSidePanels } from './WorkspaceSidePanels';

export function App(): JSX.Element {
  // Recovery first — runs once on mount, prompts the user before any
  // edits land. Then start the 30s autosave loop for the remainder of
  // the session. Global error handlers catch what the ErrorBoundary
  // can't (event-handler throws + unhandled promise rejections).
  useAutosaveRecovery();
  usePolylineFairingUpgrade();
  useSingleArtworkSelection();
  useAutosave();
  useMaterialLibraryPersistence();
  useCncLibraryPersistence();
  useCompactRailDefaults();
  useLayerDefaultsPersistence();
  useGlobalErrorHandlers();
  useImportDragDrop();
  useJobShortcuts();
  useShortcuts();
  useSpacePan();
  useActiveJobWakeLock();
  useJobCheckpoint();
  useUnloadStop();
  useUnsavedChangesGuard();
  useWindowTitle();
  return (
    <div style={shellStyle}>
      <CommandShell />
      <main style={mainStyle}>
        <ToolStrip />
        <div style={canvasAreaStyle}>
          <Workspace />
          <WorkspaceCameraOverlay />
          <RegistrationJigPanel />
          <CameraPanel />
          <BoardCapturePanel />
        </div>
        <Cnc3DPane />
        <WorkspaceSidePanels />
      </main>
      <LiveMotionBar />
      <StatusBar />
      <Toasts />
      <PwaUpdatePromptGate />
      <AddTextDialog />
      <DesignLibraryDialog />
      <ImportImageDialog />
      <ConfirmSaveDialog />
      <JobReviewDialog />
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  margin: 0,
  fontFamily: 'system-ui, sans-serif',
};
const mainStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
};
const canvasAreaStyle: React.CSSProperties = {
  // flex:1 + minWidth:0 lets the workspace shrink to whatever the side rails
  // leave. overflow:hidden prevents the inner canvas (with width: 100%) from
  // forcing the flexbox open when sized between paint frames.
  flex: 1,
  minWidth: 0,
  position: 'relative',
  overflow: 'hidden',
};
