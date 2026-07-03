// Root App component. Wires Toolbar (top) + Workspace (center) +
// CutsLayersPanel (right) + StatusBar (bottom). Window-level drag-drop import
// and keyboard shortcuts live in dedicated hooks so this component stays a
// thin layout shell.

import { CutsLayersPanel } from '../layers';
import { ConfirmSaveDialog, StatusBar, Toasts } from '../common';
import { CommandShell } from '../commands';
import { LaserWindow, useJobShortcuts } from '../laser';
import { AddTextDialog } from '../text/AddTextDialog';
import { ImportImageDialog } from '../trace/ImportImageDialog';
import { CameraPanel, WorkspaceCameraOverlay } from '../camera';
import { RegistrationJigPanel, ToolStrip, Workspace } from '../workspace';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';
import { useAutosave, useAutosaveRecovery } from './use-autosave';
import { useActiveJobWakeLock } from './use-active-job-wake-lock';
import { useCncLibraryPersistence } from './use-cnc-library-persistence';
import { useGlobalErrorHandlers } from './use-global-error-handlers';
import { useImportDragDrop } from './use-import-drag-drop';
import { useLayerDefaultsPersistence } from './use-layer-defaults-persistence';
import { useMaterialLibraryPersistence } from './use-material-library-persistence';
import { useShortcuts } from './use-shortcuts';
import { useSpacePan } from './use-space-pan';
import { useUnloadStop } from './use-unload-stop';
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard';
import { useWindowTitle } from './use-window-title';

export function App(): JSX.Element {
  // Recovery first — runs once on mount, prompts the user before any
  // edits land. Then start the 30s autosave loop for the remainder of
  // the session. Global error handlers catch what the ErrorBoundary
  // can't (event-handler throws + unhandled promise rejections).
  useAutosaveRecovery();
  useAutosave();
  useMaterialLibraryPersistence();
  useCncLibraryPersistence();
  useLayerDefaultsPersistence();
  useGlobalErrorHandlers();
  useImportDragDrop();
  useJobShortcuts();
  useShortcuts();
  useSpacePan();
  useActiveJobWakeLock();
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
        </div>
        <CutsLayersPanel />
        <LaserWindow />
      </main>
      <StatusBar />
      <Toasts />
      <PwaUpdatePrompt />
      <AddTextDialog />
      <ImportImageDialog />
      <ConfirmSaveDialog />
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
