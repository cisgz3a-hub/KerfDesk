// Root App component. Wires Toolbar (top) + Workspace (center) +
// CutsLayersPanel (right) + StatusBar (bottom). Window-level drag-drop import
// and keyboard shortcuts live in dedicated hooks so this component stays a
// thin layout shell.

import { useMemo } from 'react';
import { AppDialogHost, ConfirmSaveDialog, SaveFilenamePanel, StatusBar, Toasts } from '../common';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ArtworkCreationHost } from '../layers/ArtworkCreationHost';
import { ProjectSheetsBar } from '../commands/ProjectSheetsBar';
import { CommandShell } from '../commands';
import { CanvasGcodeView, CanvasViewSwitch } from '../gcode-inspector';
import { useCanvasViewStore } from '../state/canvas-view-store';
import { UpdatePrompt } from '../licensing/UpdatePrompt';
import { LiveMotionBar, useAbortShortcut, useStartShortcut } from '../laser';
import { MachineSetupDialogHost } from '../laser/device-setup';
import { BoardCapturePanel } from '../laser/board-capture';
import { JobReviewDialog } from '../laser/job-review';
import { SecondPassHost } from '../laser/second-pass/SecondPassHost';
import { WorkspaceSafetyNotice } from '../laser/WorkspaceSafetyNotice';
import { AddTextDialog } from '../text/AddTextDialog';
import { DesignLibraryHost } from '../library/DesignLibraryHost';
import { ImportImageDialog } from '../trace/ImportImageDialog';
import { PagedImportDialog } from '../import/PagedImportDialog';
import { CameraPanel, WorkspaceCameraOverlay } from '../camera';
import { DesignStudioHost } from '../design-studio';
import { ImageEditorHost } from '../image-editor/ImageEditorHost';
import { CncStockCanvasHud, RegistrationJigPanel, ToolStrip, Workspace } from '../workspace';
import { WorkspaceViewport } from '../workspace/WorkspaceViewport';
import { PwaUpdateWatcherGate } from './PwaUpdateWatcherGate';
import { useAutosave } from './use-autosave';
import { AutosaveRecoveryCard } from './AutosaveRecoveryCard';
import { UnsavedWorkHost } from './UnsavedWorkDialog';
import { BrowserFilesNotice } from './BrowserFilesNotice';
import { ProProjectDesktopDialog } from './ProProjectDesktopDialog';
import { useActiveJobWakeLock } from './use-active-job-wake-lock';
import { useJobWatch } from '../camera/job-watch/job-watch-runner';
import { useCameraHelpers } from '../camera/helpers/install-camera-helpers';
import { useAutoConnectController } from './use-auto-connect-controller';
import { useCncLibraryPersistence } from './use-cnc-library-persistence';
import { useGlobalErrorHandlers } from './use-global-error-handlers';
import { useJobCheckpoint } from './use-job-checkpoint';
import { useLayerDefaultsPersistence } from './use-layer-defaults-persistence';
import { useMachineHoursTracking } from './use-machine-hours-tracking';
import { useMachineProfilePersistence } from './use-machine-profile-persistence';
import { useMaterialLibraryPersistence } from './use-material-library-persistence';
import { usePolylineFairingUpgrade } from './use-polyline-fairing-upgrade';
import { useShortcuts } from './use-shortcuts';
import { useSingleArtworkSelection } from './use-single-artwork-selection';
import { useOperationColorPeek } from './use-operation-color-peek';
import { useSpacePan } from './use-space-pan';
import { useUnloadStop } from './use-unload-stop';
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard';
import { useWindowTitle } from './use-window-title';
import { WorkspaceSidePanels } from './WorkspaceSidePanels';
import './workspace-layout.css';
import { ProjectBedReconciliationBanner } from './ProjectBedReconciliationBanner';
import { MachineSetupBanner } from './MachineSetupBanner';
import { ExternalGcodePreviewBanner } from './ExternalGcodePreviewBanner';
import { DesktopCloseNotice } from './DesktopCloseNotice';
import { DesktopSessionEndNotice } from './DesktopSessionEndNotice';
import { TutorialHost } from '../tutorials/TutorialHost';
import { FirstJobGuideHost } from '../first-job/FirstJobGuide';
import { RecentProjectsHost } from '../recent-projects/RecentProjectsHost';
import { SupportReportHost } from '../support/SupportReportHost';
import { RemotePairingHost } from '../remote-access/RemotePairingHost';
import { useRemoteAccess } from './use-remote-access';
import { CrashScreenHosts, machineSoftwareAbort, projectCrashSave } from './crash-recovery';
import { usePlatformOptional } from './platform-context';

// A render crash replaces only the workspace. The job runs from the store, so
// it keeps streaming under the crash screen, and the protections it relies on
// stay mounted beside the boundary rather than inside it (audit 27-P2-2).
export function App(): JSX.Element {
  const platform = usePlatformOptional();
  const crashSave = useMemo(
    () => (platform === null ? undefined : projectCrashSave(platform)),
    [platform],
  );
  return (
    <>
      <ErrorBoundary
        softwareAbort={machineSoftwareAbort}
        {...(crashSave === undefined ? {} : { crashSave })}
        crashHosts={<CrashScreenHosts />}
      >
        <AppWorkspace />
      </ErrorBoundary>
      <SupportReportHost />
      <AppProtections />
    </>
  );
}

function AppWorkspace(): JSX.Element {
  return (
    <div className="lf-app-shell" style={shellStyle}>
      <CommandShell />
      <BrowserFilesNotice />
      <DesktopCloseNotice />
      <DesktopSessionEndNotice />
      <ProProjectDesktopDialog />
      <ProjectBedReconciliationBanner />
      <ExternalGcodePreviewBanner />
      <RecentProjectsHost />
      <UnsavedWorkHost />
      <main style={mainStyle}>
        <ToolStrip />
        <CanvasArea />
        {/*
          The 3D result pane is deliberately not mounted (maintainer, 2026-08-03).
          It is a separate, continuously updating design-scene consumer rather
          than either explicit G-code 3D surface or Preview's Cut 3D dialog. Its
          whole-project preparation is off-thread now, and a test-only A/B mount
          stays responsive, but a permanent WebGL/render workload has not passed
          perceptual, GPU or production-hardware qualification. Keep Cnc3DPane
          available for controlled tests without restoring its production mount.
        */}
        <WorkspaceSidePanels />
      </main>
      <StatusBar />
      {/* Window-level popups (ADR-207 amendment). Both are `position: fixed`,
          so they take no layout space anywhere: mounting either one cannot
          resize the workspace or shift the rails. Neither may overlay the
          drawing surface at rest — a click-to-dismiss toast under the pointer
          swallows the mousedown that starts a drag. */}
      <Toasts />
      <LiveMotionBar />
      <PwaUpdateWatcherGate />
      <ArtworkCreationHost />
      <AddTextDialog />
      <DesignLibraryHost />
      <ImportImageDialog />
      <PagedImportDialog />
      <ConfirmSaveDialog />
      <SaveFilenamePanel />
      <JobReviewDialog />
      <SecondPassHost />
      <MachineSetupDialogHost />
      <ImageEditorHost />
      <DesignStudioHost />
      <TutorialHost />
      <FirstJobGuideHost />
      <RemotePairingHost />
      {/* Last of the dialogs: a question asked from inside another dialog must
          paint above it and be the topmost modal (ADR-707). */}
      <AppDialogHost />
      <WorkspaceLifecycle />
    </div>
  );
}

// App-wide hooks live in leaves that render nothing. Nothing below App is
// memoised, so a hook that re-rendered App re-rendered every rail, dialog host
// and the workspace with it — which the status poll and each cursor hover did
// while the shortcut hooks subscribed from here. Each leaf is mounted last in
// its tree, so its effects still run after every sibling's.
//
// These serve the workspace's editing and go with it when it crashes.
function WorkspaceLifecycle(): null {
  useRemoteAccess();
  usePolylineFairingUpgrade();
  useSingleArtworkSelection();
  useStartShortcut();
  useShortcuts();
  useSpacePan();
  useOperationColorPeek();
  useJobWatch();
  useCameraHelpers();
  useAutoConnectController();
  useWindowTitle();
  return null;
}

// These protect a running job and unsaved work, so a render crash must not
// switch them off: autosave and the settings stores' persistence, async error
// toasts, Ctrl+. Abort, the wake lock (ADR-117), recovery checkpoints, machine
// hours, the tab-close laser-off with the desktop close handshake (C3,
// ADR-549) and the unsaved-changes prompt (H-U6).
function AppProtections(): null {
  // Recovery stays a nonblocking canvas card. Background autosave protects
  // edits throughout the session; global handlers catch asynchronous errors.
  useAutosave();
  useMachineProfilePersistence();
  useMaterialLibraryPersistence();
  useCncLibraryPersistence();
  useLayerDefaultsPersistence();
  useGlobalErrorHandlers();
  useAbortShortcut();
  useActiveJobWakeLock();
  useJobCheckpoint();
  useMachineHoursTracking();
  useUnloadStop();
  useUnsavedChangesGuard();
  return null;
}

// The main canvas has two modes (ADR-255): the design view, and a G-code 3D
// PREVIEW of what this project compiles to. The switch is above the canvas
// because it is a glance, not a workbench — the toolbar's "Inspect G-code
// (3D)" opens the in-depth screen. Both stay usable during a job, where
// watching the running program is the point.
function CanvasArea(): JSX.Element {
  const showGcode = useCanvasViewStore((store) => store.showGcode);
  const setShowGcode = useCanvasViewStore((store) => store.setShowGcode);
  // The G-code 3D view is the G-code Inspector's, free in every edition (ADR-627).
  const changeView = (next: boolean): void => setShowGcode(next);
  const accessories = (
    <>
      <WorkspaceCameraOverlay />
      <CameraPanel />
      <BoardCapturePanel />
      {!showGcode ? <CncStockCanvasHud /> : null}
      <MachineSetupBanner />
      <AutosaveRecoveryCard />
      <UpdatePrompt />
      <WorkspaceSafetyNotice />
    </>
  );
  return (
    <WorkspaceViewport
      controls={<CanvasViewSwitch showGcode={showGcode} onChange={changeView} />}
      banner={<RegistrationJigPanel />}
      footer={<ProjectSheetsBar />}
      content={
        showGcode ? (
          <div className="lf-workspace-stage">
            <CanvasGcodeView active />
          </div>
        ) : (
          <Workspace />
        )
      }
    >
      {/* G-code owns the canvas, so Workspace is unmounted rather than merely
          covered. Its cleanup cancels idle motion/preview workers and makes a
          late heavy result incapable of committing or drawing underneath. */}
      {accessories}
    </WorkspaceViewport>
  );
}

const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
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
