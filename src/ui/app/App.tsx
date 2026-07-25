// Root App component. Wires Toolbar (top) + Workspace (center) +
// CutsLayersPanel (right) + StatusBar (bottom). Window-level drag-drop import
// and keyboard shortcuts live in dedicated hooks so this component stays a
// thin layout shell.

import { ConfirmSaveDialog, StatusBar, Toasts } from '../common';
import { CommandShell } from '../commands';
import { CanvasGcodeView, CanvasViewSwitch } from '../gcode-inspector';
import { useCanvasViewStore } from '../state/canvas-view-store';
import { LiveMotionBar, useJobShortcuts } from '../laser';
import { BoardCapturePanel } from '../laser/board-capture';
import { JobReviewDialog } from '../laser/job-review';
import { AddTextDialog } from '../text/AddTextDialog';
import { DesignLibraryDialog } from '../library/DesignLibraryDialog';
import { ImportImageDialog } from '../trace/ImportImageDialog';
import { CameraPanel, WorkspaceCameraOverlay } from '../camera';
import { ImageEditorHost } from '../image-editor/ImageEditorHost';
import { Cnc3DPane, RegistrationJigPanel, ToolStrip, Workspace } from '../workspace';
import { PwaUpdateWatcherGate } from './PwaUpdateWatcherGate';
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
        <CanvasArea />
        <Cnc3DPane />
        <WorkspaceSidePanels />
      </main>
      <LiveMotionBar />
      <StatusBar />
      <Toasts />
      <PwaUpdateWatcherGate />
      <AddTextDialog />
      <DesignLibraryDialog />
      <ImportImageDialog />
      <ConfirmSaveDialog />
      <JobReviewDialog />
      <ImageEditorHost />
    </div>
  );
}

// The main canvas has two modes (ADR-255): the design view, and a G-code 3D
// PREVIEW of what this project compiles to. The switch is on the canvas
// because it is a glance, not a workbench — the toolbar's "Inspect G-code
// (3D)" opens the in-depth screen. Both stay usable during a job, where
// watching the running program is the point.
function CanvasArea(): JSX.Element {
  const showGcode = useCanvasViewStore((store) => store.showGcode);
  const setShowGcode = useCanvasViewStore((store) => store.setShowGcode);
  return (
    <div style={canvasAreaStyle}>
      <Workspace />
      <WorkspaceCameraOverlay />
      <RegistrationJigPanel />
      <CameraPanel />
      <BoardCapturePanel />
      {showGcode ? <CanvasGcodeView active /> : null}
      <div style={canvasSwitchStyle}>
        <CanvasViewSwitch showGcode={showGcode} onChange={setShowGcode} />
      </div>
    </div>
  );
}

// Sits above both the canvas and the G-code preview, with its own elevation
// so it reads as a control rather than part of the drawing.
const canvasSwitchStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 12,
  zIndex: 4,
  boxShadow: 'var(--lf-shadow)',
  borderRadius: 'var(--lf-radius-lg)',
};

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
