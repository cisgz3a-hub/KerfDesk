/**
 * === FILE: /src/ui/components/App.tsx ===
 *
 * Purpose:    Root application component. Owns the Scene state,
 *             integrates the scene history store for undo/redo, and wires
 *             file operations to the toolbar.
 *
 *             State flow:
 *               onSceneChange  → setScene (preview, no history)
 *               onSceneCommit  → history.push + setScene (persist)
 *               Ctrl+Z         → history.undo + setScene
 *               Ctrl+Y/Ctrl+Shift+Z → history.redo + setScene
 *
 * Dependencies:
 *   - /src/core/scene/Scene.ts
 *   - /src/ui/stores/sceneHistoryStore.ts
 *   - /src/ui/components/FileToolbar.tsx
 *   - /src/ui/components/CanvasViewport.tsx
 * Last updated: UI Wiring — App Shell
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { type Scene } from '../../core/scene/Scene';
// T2-6 Phase 3u: selection helpers extracted so the filter +
// select-all rules can be tested without mounting App.
import {
  selectAllSelectableIds,
} from './app/appSelectionHelpers';
// T2-6 Phase 3v: active-layer-mode derivations extracted.
import {
  activeLayerMode as deriveActiveLayerMode,
  interactableLayerIds as deriveInteractableLayerIds,
} from './app/appLayerModeHelpers';
// T2-6 Phase 3w: layout-width math + connection-status predicate.
import {
  computeCanvasSize,
  computeLayoutWidths,
  isLaserConnected,
} from './app/appLayoutHelpers';
import { makeCommitSceneTransaction, type CommitSceneTransaction } from '../scene/SceneTransaction';
import { type SceneCommitAction } from '../scene/SceneCommitActions';
import { installAppDebugStateGraph } from '../../debug/AppDebugState';
import { transitionFromSceneTransaction, transitionLog } from '../../debug/TransitionLog';
import { useTraceStormProbe } from '../../debug/traceStormProbe';
import { FileToolbar } from './FileToolbar';
import { buildAppFileToolbarProps } from './appFileToolbarProps';
import { AppDragDropOverlay } from './AppDragDropOverlay';
import { AppRecoverySetup } from './AppRecoverySetup';
import { AppFirstRunGuideBridge } from './AppFirstRunGuideBridge';
import { AppModal } from './AppModal';
import { useModal } from '../hooks/useModal';
import { useClipboard } from '../hooks/useClipboard';
import { useImport } from '../hooks/useImport';
import { useCompileManager } from '../hooks/useCompileManager';
import { useConnectionHandlers } from '../hooks/useConnectionHandlers';
import { useSettingsLiveCapabilities } from '../hooks/useSettingsLiveCapabilities';
import { useWizardHandlers, getSetupStorageKey } from '../hooks/useWizardHandlers';
import { useQuickActionHandlers } from '../hooks/useQuickActionHandlers';
import { useFileHandlers } from '../hooks/useFileHandlers';
import { useAppGeneratorWorkflows } from '../hooks/useAppGeneratorWorkflows';
import { useAppDeviceProfiles } from '../hooks/useAppDeviceProfiles';
import { useGrblDerivedMachineInfo } from '../hooks/useGrblDerivedMachineInfo';
import { useAppMaterialWorkflows } from '../hooks/useAppMaterialWorkflows';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDialogs } from '../hooks/useDialogs';
import { useAppNudgeWorkflow } from '../hooks/useAppNudgeWorkflow';
import { useAppKeyboardWorkflow } from '../hooks/useAppKeyboardWorkflow';
import { useActiveJobCanvasStore } from '../stores/activeJobCanvasStore';
import { useAppDialogsStore } from '../stores/appDialogsStore';
import { useAppSettingsStore } from '../stores/appSettingsStore';
import { useEditorStore } from '../stores/editorStore';
import { useMachineStartStore } from '../stores/machineStartStore';
import { useSceneHistoryStore } from '../stores/sceneHistoryStore';
import { useSceneStore } from '../stores/sceneStore';
import { useViewportStore } from '../stores/viewportStore';
import { useSceneOperations } from '../hooks/useSceneOperations';
import { useControllerConnection } from '../hooks/useControllerConnection';
import { useMachineService } from '../hooks/useMachineService';
import { sendResetWcsCommand } from '../../app/sendResetWcsCommand';
import { CanvasViewport, type ViewportActions } from './CanvasViewport';
import { buildAppCanvasViewportProps } from './appCanvasViewportProps';
import { ModeTabsOverlay } from './canvas/ModeTabsOverlay';
import { LayerPanel } from './LayerPanel';
import { ToolBar, type ToolType } from './ToolBar';
import { ContextMenu } from './ContextMenu';
import { GridArrayDialog } from './GridArrayDialog';
import { MaterialTestDialog } from './MaterialTestDialog';
import { GcodePreview } from './GcodePreview';
import { MaterialDialog } from './MaterialDialog';
import { importDxfIntoScene } from '../../import/dxf';
import { serializeForAutosave, serializeScene } from '../../io/SceneSerializer';
import { readAutosave, writeAutosave, writeAutosaveAsync, clearAutosave } from '../../app/autosavePersistence';
import { evaluateRecoveryEligibility } from '../../app/recoveryEligibility';
import { getUnsafePriorState, clearUnsafePriorState } from '../../app/unsafePriorState';
import { hashSceneForPersistence, isDirty } from '../../core/scene/sceneDirtyHash';
import { generateId } from '../../core/types';
import { type SceneObject } from '../../core/scene/SceneObject';
import { selectSceneBounds } from '../../core/scene/bounds';
import { resolveFrameSceneBounds, resolveFrameTransformBounds } from '../../app/frameGcode';
import { theme } from '../styles/theme';
import { ShortcutsPanel } from './ShortcutsPanel';
import { ConnectionPanel } from './ConnectionPanel';
import { buildAppConnectionPanelProps } from './appConnectionPanelProps';
import { TemplateBrowser } from './TemplateBrowser';
import { BoxGenerator } from './BoxGenerator';
import { BoxStudioPage } from '../pages/BoxStudioPage';
import { NestingDialog } from './NestingDialog';
import { MaterialLibraryDialog } from './MaterialLibraryDialog';
import { CameraDialog } from './CameraDialog';
import { KerfWizard } from './KerfWizard';
import { VariableTextDialog } from './VariableTextDialog';
import { AppTextDialogs } from './AppTextDialogs';
import { StatusFooter } from './StatusFooter';
import { MaterialBar, type MaterialBarHandle } from './MaterialBar';
import { CalibrateMaterialDialog } from './materials/CalibrateMaterialDialog';
import { LearnedToast } from './LearnedToast';
import { UpdateNotice } from './UpdateNotice';
import { getSuggestion } from '../../core/materials/MaterialFeedback';
import { BUNDLED_FONTS } from '../../fonts/fontRegistry';
import { injectBundledFontFaces } from '../../fonts/injectFontFaces';
import { type SettingsTab } from './SettingsModal';
import { AppSettingsModal } from './AppSettingsModal';
import { type GcodeStartMode } from '../../core/output/GcodeOrigin';
import {
  shouldResetStartModeAfterDisconnect,
  shouldNudgeStartModeToCurrent,
} from './app/appStartModeDecisions';
import { type UserMode } from '../../app/UserModeGates';
import {
  textOperationModeForObject,
} from '../scene/TextOperationLayer';
import { buildTextDialogSceneCommit } from './app/appTextCommitHelpers';
import { buildModeTabSelectResult } from './app/appModeTabHelpers';
import { buildDeleteSelectionCommit } from './app/appDeleteSelectionHelpers';
import { buildActivateLayerCommit } from './app/appActivateLayerHelpers';
import {
  buildStartModeSelectionCommit,
  resolveStartModeStatusLabel,
} from './app/appStartModeSelectionHelpers';
import { buildCameraPositionCommit } from './app/appCameraPositionHelpers';
import {
  resolveProductionModeToggle,
  resolveUserModeSelection,
} from './app/appModePreferenceHelpers';
import { buildHistoryNavigationCommit } from './app/appHistoryNavigationHelpers';
import { resolveMaterialSuggestionRequest } from './app/appMaterialSuggestionHelpers';
import {
  shouldClearToolpathPreview,
  shouldCompileToolpathPreview,
} from './app/appToolpathPreviewHelpers';
import { buildTextPreviewFontLoadRequest } from './app/appTextPreviewFontHelpers';
import {
  shouldPersistAutosaveForHash,
  shouldSkipAutosaveForRunningJob,
} from './app/appAutosaveHelpers';
import { buildExitFlowPlan } from './app/appExitHelpers';

type StartMode = GcodeStartMode;
import { gatedFeature, isProUnlocked } from '../utils/proGate';

// ─── COMPONENT ───────────────────────────────────────────────────

// T2-6 Phase 3u: filterValidIds moved to ./app/appSelectionHelpers.

export function App(): React.ReactElement {
  // T1-17-followup-trace-probe: counts App-level commits during a trace
  // session so we can pin which component committed the most. No-op
  // outside a session.
  useTraceStormProbe('App');

  const {
    modal,
    showAlert,
    showConfirm,
    showChoice,
    showConfirmWithCheckbox,
    showPrompt,
    dismissModal,
    finishAlert,
    finishConfirm,
    finishChoice,
    finishConfirmWithCheckbox,
    finishPrompt,
  } = useModal();
  const dialogs = useDialogs();
  const {
    closeTextDialog,
    openTextEdit,
    setEditingTextId,
    setShowSetup,
    setShowTextDialog,
    setTextOperationMode,
  } = dialogs;
  const zoomLevel = useViewportStore(s => s.zoomLevel);
  const setZoomLevel = useViewportStore(s => s.setZoomLevel);
  const viewportActionsRef = useRef<ViewportActions | null>(null);
  const materialBarRef = useRef<MaterialBarHandle | null>(null);

  // Load bundled fonts into browser font lookup so dialog/preview canvas text
  // resolves families like "Inter" instead of falling back to a default serif.
  useEffect(() => {
    void injectBundledFontFaces();
  }, []);

  const scene = useSceneStore(s => s.scene);
  const setScene = useSceneStore(s => s.setScene);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  // T1-109: scene bounds for the framing path must match what the
  // JobCompiler will actually emit — visible objects on visible &&
  // output layers. Pre-T1-109 this iterated `scene.objects` filtered
  // only by `obj.visible`, which inflated the frame box to include
  // guide / reference layers (output: false) and could push the
  // frame off-bed even though the burn area was inside.
  const outputSceneBounds = useMemo(
    () => selectSceneBounds(scene, 'output'),
    [scene],
  );

  const canvasSize = useViewportStore(s => s.canvasSize);
  const setCanvasSize = useViewportStore(s => s.setCanvasSize);
  const selectedIds = useEditorStore(s => s.selectedIds);
  const setSelectedIds = useEditorStore(s => s.setSelectedIds);
  // T2-78: ref-shadow of selectedIds so SceneTransaction's getSelection
  // dep can read the freshest value without rebuilding the useMemo on
  // every selection change. Synced via the useEffect below.
  const selectedIdsRef = useRef<ReadonlySet<string>>(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const activeTool = useEditorStore(s => s.activeTool);
  const setActiveTool = useEditorStore(s => s.setActiveTool);
  const isDragOver = useAppDialogsStore(s => s.isDragOver);
  const setIsDragOver = useAppDialogsStore(s => s.setIsDragOver);
  const showGridArray = useAppDialogsStore(s => s.showGridArray);
  const setShowGridArray = useAppDialogsStore(s => s.setShowGridArray);
  const gridArrayBounds = useAppDialogsStore(s => s.gridArrayBounds);
  const setGridArrayBounds = useAppDialogsStore(s => s.setGridArrayBounds);
  const showNesting = useAppDialogsStore(s => s.showNesting);
  const setShowNesting = useAppDialogsStore(s => s.setShowNesting);
  const showMaterialTest = useAppDialogsStore(s => s.showMaterialTest);
  const setShowMaterialTest = useAppDialogsStore(s => s.setShowMaterialTest);
  const showCalibrateMaterial = useAppDialogsStore(s => s.showCalibrateMaterial);
  const setShowCalibrateMaterial = useAppDialogsStore(s => s.setShowCalibrateMaterial);
  const showMaterialLibrary = useAppDialogsStore(s => s.showMaterialLibrary);
  const setShowMaterialLibrary = useAppDialogsStore(s => s.setShowMaterialLibrary);
  const materialLibraryRevision = useAppDialogsStore(s => s.materialLibraryRevision);
  const bumpMaterialLibraryRevision = useAppDialogsStore(s => s.bumpMaterialLibraryRevision);
  const showCamera = useAppDialogsStore(s => s.showCamera);
  const setShowCamera = useAppDialogsStore(s => s.setShowCamera);
  const showKerfWizard = useAppDialogsStore(s => s.showKerfWizard);
  const setShowKerfWizard = useAppDialogsStore(s => s.setShowKerfWizard);
  const showFontCredits = useAppDialogsStore(s => s.showFontCredits);
  const setShowFontCredits = useAppDialogsStore(s => s.setShowFontCredits);
  const settingsOpen = useAppDialogsStore(s => s.settingsOpen);
  const settingsInitialTab = useAppDialogsStore(s => s.settingsInitialTab);
  const openSettings = useAppDialogsStore(s => s.openSettings);
  const closeSettings = useAppDialogsStore(s => s.closeSettings);
  const showBoxStudio = useAppDialogsStore(s => s.showBoxStudio);
  const setShowBoxStudio = useAppDialogsStore(s => s.setShowBoxStudio);
  const profileRevision = useMachineStartStore(s => s.profileRevision);
  const bumpProfileRevision = useMachineStartStore(s => s.bumpProfileRevision);
  const startMode = useMachineStartStore(s => s.startMode);
  const setStartMode = useMachineStartStore(s => s.setStartMode);
  const savedOrigin = useMachineStartStore(s => s.savedOrigin);
  const setSavedOrigin = useMachineStartStore(s => s.setSavedOrigin);
  const resetCurrentModeAfterDisconnect = useMachineStartStore(s => s.resetCurrentModeAfterDisconnect);
  const startModeRef = useRef(startMode);
  startModeRef.current = startMode;
  const gcodePreview = useAppDialogsStore(s => s.gcodePreview);
  const setGcodePreview = useAppDialogsStore(s => s.setGcodePreview);
  const showToolpathPreview = useAppDialogsStore(s => s.showToolpathPreview);
  const setShowToolpathPreview = useAppDialogsStore(s => s.setShowToolpathPreview);
  const toolpathPreviewMoves = useAppDialogsStore(s => s.toolpathPreviewMoves);
  const setToolpathPreviewMoves = useAppDialogsStore(s => s.setToolpathPreviewMoves);
  const clearToolpathPreview = useAppDialogsStore(s => s.clearToolpathPreview);
  const previewMode = useViewportStore(s => s.previewMode);
  const togglePreviewMode = useViewportStore(s => s.togglePreviewMode);
  const bedTabLayout = useViewportStore(s => s.bedTabLayout);
  const handleViewportLayout = useViewportStore(s => s.setBedTabLayout);

  const activeJobMoves = useActiveJobCanvasStore(s => s.activeJobMoves);
  const activeJobPlanBounds = useActiveJobCanvasStore(s => s.activeJobPlanBounds);
  const activeJobTransform = useActiveJobCanvasStore(s => s.activeJobTransform);
  const setActiveJobCanvasContext = useActiveJobCanvasStore(s => s.setActiveJobCanvasContext);
  const clearActiveJobCanvasContext = useActiveJobCanvasStore(s => s.clearActiveJobCanvasContext);
  const grbl = useControllerConnection('grbl');
  const machineUi = useMachineService({
    controllerRef: grbl.controllerRef,
    portRef: grbl.portRef,
    // T2-56: signals when the controller is ready so the service can
    // attach its auto-finalize listener (formerly a useEffect inside
    // ConnectionPanel that missed the run→idle transition if the
    // panel was unmounted).
    controllerReady: grbl.controllerReady,
  });
  const wasJobRunningRef = useRef(false);

  useEffect(() => {
    installAppDebugStateGraph({
      sceneRef,
      selectedIdsRef,
      hashScene: hashSceneForPersistence,
      controllerRef: grbl.controllerRef,
    });
  }, [grbl.controllerRef]);

  // T2-6 Phase 3t: GRBL machine-info derivations extracted into a single
  // hook. Memoization keys mirror the originals exactly.
  const {
    machinePositionForStartWizard,
    liveJobCanvasPosition,
    machineBedFromGrbl,
    machineAccelFromGrbl,
    grblMachineInfo,
  } = useGrblDerivedMachineInfo({
    controller: grbl.controller,
    machineState: grbl.machineState,
    isJobRunning: grbl.isJobRunning,
    activeJobTransform,
  });

  const connectionSidebarOpen = dialogs.showConnection && grbl.controllerReady;
  const settingsLiveCapabilities = useSettingsLiveCapabilities(grbl.controller, grbl.machineState);

  const handleSceneCommitRef = useRef<((newScene: Scene) => void) | null>(null);
  const {
    activeProfile,
    activeProfileId,
    resolvedMachineBedWidthMm,
    resolvedMachineBedHeightMm,
    resolvedMachineBedDimensionsKnown,
    allProfiles,
    refreshProfiles,
    updateActiveProfile,
    setActiveProfileAndApply,
    createProfileFromCurrentScene,
    updateCurrentProfileFromScene,
    deleteProfileAndClearActive,
    handleAutoDetectMachine,
  } = useAppDeviceProfiles({
    scene,
    profileRevision,
    bumpProfileRevision,
    machineBedFromGrbl,
    grblMachineInfo,
    controller: grbl.controller,
    showConfirmWithCheckbox,
    applyProfileScene: (nextScene) => handleSceneCommitRef.current?.(nextScene),
  });
  void materialLibraryRevision;

  const {
    currentGcode,
    setCurrentGcode,
    compileGcode,
    compileToolpath,
    gcodeStale,
    setGcodeStale,
    sceneCompileTick,
    lastResult,
    isCompiling,
    compileProgress,
    isCompileCancelling,
    cancelCompile,
  } = useCompileManager({
    scene,
    startMode,
    savedOrigin,
    controllerMaxSpindle: grbl.controller?.maxSpindle ?? null,
    machineBedFromController: machineBedFromGrbl,
    controllerAccelMmPerS2: machineAccelFromGrbl,
    connectionSidebarOpen,
    outputFormat: 'grbl',
    isJobRunning: grbl.isJobRunning,
  });

  // T3-36 follow-up: framing prefers fresh compiled canvas burn bounds when
  // they exist. Raw object output bounds remain the fallback for no/stale G-code.
  const sceneBounds = useMemo(
    () => resolveFrameSceneBounds({
      outputBounds: outputSceneBounds,
      compiledCanvasBurnBounds:
        !gcodeStale && currentGcode && lastResult ? lastResult.canvasBurnBounds ?? null : null,
      compiledCanvasPlanBounds:
        !gcodeStale && currentGcode && lastResult ? lastResult.canvasPlanBounds : null,
      hasFreshCompile: !gcodeStale && Boolean(currentGcode) && lastResult != null,
    }),
    [outputSceneBounds, gcodeStale, currentGcode, lastResult],
  );

  const frameTransformBounds = useMemo(
    () => resolveFrameTransformBounds({
      outputBounds: outputSceneBounds,
      compiledCanvasPlanBounds: lastResult?.canvasPlanBounds ?? null,
      hasFreshCompile: !gcodeStale && Boolean(currentGcode) && lastResult != null,
    }),
    [outputSceneBounds, gcodeStale, currentGcode, lastResult],
  );

  useEffect(() => {
    if (grbl.isJobRunning && !wasJobRunningRef.current) {
      const ctx = machineUi.service.getActiveJobCanvasContext();
      if (ctx) {
        setActiveJobCanvasContext({
          moves: ctx.canvasMoves,
          planBounds: ctx.canvasPlanBounds,
          transform: ctx.machineTransform,
        });
      } else {
        console.warn(
          '[App] Job running but no active job canvas context — clearing active job canvas state',
        );
        clearActiveJobCanvasContext();
      }
    } else if (!grbl.isJobRunning && wasJobRunningRef.current) {
      clearActiveJobCanvasContext();
    }
    wasJobRunningRef.current = grbl.isJobRunning;
  }, [grbl.isJobRunning, machineUi.service, setActiveJobCanvasContext, clearActiveJobCanvasContext]);

  // T2-6 Phase 3w: layout-width math + connection-status delegated
  // to pure helpers.
  const { connectionSidebarWidth, layersPanelWidth, toolbarWidth, canvasViewportWidth } =
    computeLayoutWidths(canvasSize.width, connectionSidebarOpen);

  const toolbarLaserConnected = useMemo(
    () => isLaserConnected(grbl.machineState),
    [grbl.machineState],
  );

  useEffect(() => {
    if (shouldResetStartModeAfterDisconnect({
      machineStatus: grbl.machineState?.status,
      currentStartMode: startModeRef.current,
      activeProfile,
    })) {
      resetCurrentModeAfterDisconnect();
    }
  }, [activeProfile, grbl.machineState?.status, resetCurrentModeAfterDisconnect]);

  const profileStartModeNudgedRef = useRef<string | null>(null);
  useEffect(() => {
    const profileId = activeProfile?.id ?? null;
    if (profileStartModeNudgedRef.current === profileId) return;
    profileStartModeNudgedRef.current = profileId;
    if (shouldNudgeStartModeToCurrent({
      activeProfile,
      currentStartMode: startModeRef.current,
    })) {
      setStartMode('current');
    }
  }, [activeProfile, setStartMode]);

  // T3-52: best-effort stop + laser-off on page exit; browser owns port teardown.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent | PageTransitionEvent) => {
      const ctrl = grbl.controllerRef.current;
      if (!ctrl) return;
      const status = ctrl.state.status;
      if (status === 'disconnected' || status === 'connecting') return;

      const jobWasRunning = ctrl.isJobRunning;
      try {
        ctrl.stop();
      } catch {
        /* port may already be gone */
      }
      void machineUi.executionCoordinator.emergencyLaserOff();

      if (jobWasRunning && e.type === 'beforeunload') {
        const beforeUnload = e as BeforeUnloadEvent;
        beforeUnload.preventDefault();
        beforeUnload.returnValue = 'A laser job was running. The laser has been stopped. Are you sure you want to close?';
      }
    };

    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    return () => { window.removeEventListener('beforeunload', handler); window.removeEventListener('pagehide', handler); };
  }, [grbl.controllerRef, machineUi.executionCoordinator]);

  const handleSaveOrigin = useCallback(async () => {
    // T1-104: exact-idle gate. T1-105: state and storage update only
    // after the G10 command is accepted by the transport.
    if (grbl.machineState?.status !== 'idle') return;
    const pos = grbl.machineState?.position;
    if (!pos) return;
    const origin = { x: pos.x, y: pos.y };
    const result = await machineUi.executionCoordinator.setOriginAtCurrentPosition();
    if (!result.ok) {
      void showAlert(
        'Set Origin failed',
        `The Set Origin command was not accepted by the controller (${result.reason ?? 'unknown reason'}). The saved origin was not updated; verify connection and try again.`,
      );
      return;
    }
    setSavedOrigin(origin);
    // T1-41: snapshot G54 *after* the Set Origin G10 command was
    // accepted, so any subsequent saved-origin job can verify the
    // work coordinate system hasn't drifted (user typing G10 in the
    // console, custom-start template containing G10/G92, reconnect,
    // firmware power loss). The snapshot is best-effort — if `$#`
    // doesn't respond inside the timeout (1s default) the snapshot
    // is null and the verify path will block subsequent saved-origin
    // jobs until the user re-runs Set Origin.
    const g54 = await machineUi.service.requestWorkOffsets();
    machineUi.service.setSavedOriginG54Snapshot(g54);
    if (!g54) {
      void showAlert(
        'Saved origin partial',
        'Set Origin succeeded, but the controller did not respond to the work-offset query. Saved-origin jobs will be blocked until you Set Origin again with a responsive controller. (T1-41)',
      );
    }
  }, [grbl.machineState, machineUi.executionCoordinator, machineUi.service, setSavedOrigin, showAlert]);
  const lastManualSaveHashRef = useRef<string>(hashSceneForPersistence(scene));
  const lastAutosaveHashRef = useRef<string>(lastManualSaveHashRef.current);
  // T1-75 (origin) + T2-76 step 3 (extended on edits) + step 5
  // (extended via unified function): bridge counter for
  // ConnectionPanelMain so it can reset hasFramed (which is
  // encapsulated in the panel) when a scene mutation invalidates the
  // frame action's burn bounds. Bumped from commitSceneTransaction's
  // invalidate.frame() callback for any non-preview kind: edits
  // (since step 3), undo/redo (since step 5), and future
  // load/async-result paths.
  const historyVersion = useSceneHistoryStore(s => s.historyVersion);
  const bumpHistoryVersion = useSceneHistoryStore(s => s.bumpHistoryVersion);
  const productionMode = useAppSettingsStore(s => s.productionMode);
  const setProductionMode = useAppSettingsStore(s => s.setProductionMode);
  const userMode = useAppSettingsStore(s => s.userMode);
  const setUserMode = useAppSettingsStore(s => s.setUserMode);
  const handleSetUserMode = useCallback((mode: UserMode) => {
    const decision = resolveUserModeSelection(userMode, mode);
    if (decision.kind === 'noop') return;
    if (decision.kind === 'set') {
      setUserMode(decision.mode);
      return;
    }
    const confirmed = confirm(
      'Switch to Advanced mode?\n\n'
      + 'Advanced mode allows explicit overrides for some beginner safety gates, including starting without framing.\n\n'
      + 'Use this only if you understand your machine behavior.',
    );
    if (confirmed) setUserMode(decision.mode);
  }, [setUserMode, userMode]);
  const handleToggleProductionMode = useCallback(() => {
    const decision = resolveProductionModeToggle({
      productionMode,
      proUnlocked: isProUnlocked(),
    });
    if (decision.kind === 'set') {
      setProductionMode(decision.enabled);
      return;
    }
    if (confirm('PRO mode is a paid feature ($30 one-time).\n\nClick OK to learn more.')) {
      window.open('https://laserforge.pages.dev/landing.html', '_blank');
    }
  }, [productionMode, setProductionMode]);

  useEffect(() => {
    if (productionMode && !isProUnlocked()) {
      setProductionMode(false);
    }
  }, [productionMode, setProductionMode]);
  const showRecover = useAppDialogsStore(s => s.showRecover);
  const setShowRecover = useAppDialogsStore(s => s.setShowRecover);
  const recoverAutosaveTimeLabel = useAppDialogsStore(s => s.recoverAutosaveTimeLabel);
  const setRecoverAutosaveTimeLabel = useAppDialogsStore(s => s.setRecoverAutosaveTimeLabel);

  useEffect(() => {
    let cancelled = false;
    void readAutosave().then(payload => {
      if (cancelled || !payload) return;
      // T1-71: recovery should fire on any meaningful change, not only
      // scenes with placed objects. A user who configured machine,
      // material, and custom layers but didn't place an object yet still
      // had real work in autosave; the previous "objects > 0" gate threw
      // it away.
      const eligibility = evaluateRecoveryEligibility(payload.json);
      if (!eligibility.shouldOffer) return;
      setShowRecover(true);
      try {
        const d = new Date(payload.timestamp);
        setRecoverAutosaveTimeLabel(
          d.toLocaleDateString() + ' ' + d.toLocaleTimeString(),
        );
      } catch {
        setRecoverAutosaveTimeLabel(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setRecoverAutosaveTimeLabel, setShowRecover]);

  // T1-29: surface the unsafe-prior-state recovery dialog at startup. The
  // flag was set by MachineService.startValidatedJob and is cleared on
  // every clean shutdown path (job completion, service disconnect,
  // failed-start cleanup). A non-null payload here means the previous
  // session reached "job started" but never reached any of those clean
  // exits — renderer crash, browser kill, cable pull, OS crash. The
  // workpiece may be partially burnt and the head may be in a dangerous
  // position. T1-25's connect-time getUnsafeAtConnect covers the
  // orthogonal case where firmware still reports a non-safe state at
  // next connect; T1-29 covers the "firmware finished cleanly while
  // we were dead" case where T1-25 alone cannot detect the prior burn.
  //
  // The alert is a modal overlay — the rest of the UI (including the
  // connect button) is unreachable until the user acknowledges. After
  // dismissal the flag is cleared so the dialog doesn't reappear on
  // subsequent restarts unless a new job triggers it again.
  useEffect(() => {
    const unsafe = getUnsafePriorState();
    if (unsafe == null) return;
    const startedLabel = (() => {
      try { return new Date(unsafe.startedAt).toLocaleString(); }
      catch { return new Date(unsafe.startedAt).toString(); }
    })();
    void showAlert(
      'Previous session ended unexpectedly',
      'A job was running when the previous session ended. The machine ' +
      'state may be unsafe — laser, head position, and workpiece may ' +
      'all have unexpected values. Inspect the machine and the ' +
      'workpiece BEFORE reconnecting.\n\n' +
      `Job started: ${startedLabel}` +
      (unsafe.ticketId ? `\nTicket: ${unsafe.ticketId}` : ''),
    ).finally(() => {
      clearUnsafePriorState();
    });
  }, [showAlert]);
  const toastSuggestion = useAppDialogsStore(s => s.toastSuggestion);
  const setToastSuggestion = useAppDialogsStore(s => s.setToastSuggestion);
  const textPlacementHint = useAppDialogsStore(s => s.textPlacementHint);
  const setTextPlacementHint = useAppDialogsStore(s => s.setTextPlacementHint);
  const textPlacementPt = useAppDialogsStore(s => s.textPlacementPt);
  const setTextPlacementPt = useAppDialogsStore(s => s.setTextPlacementPt);
  const textPreviewFontReady = useAppDialogsStore(s => s.textPreviewFontReady);
  const setTextPreviewFontReady = useAppDialogsStore(s => s.setTextPreviewFontReady);
  const lastCalibrationGridResult = useAppDialogsStore(s => s.lastCalibrationGridResult);
  const setLastCalibrationGridResult = useAppDialogsStore(s => s.setLastCalibrationGridResult);

  useEffect(() => {
    if (!textPlacementHint) return;
    const id = window.setTimeout(() => setTextPlacementHint(null), 5000);
    return () => clearTimeout(id);
  }, [setTextPlacementHint, textPlacementHint]);

  useEffect(() => {
    const request = buildTextPreviewFontLoadRequest({
      showTextDialog: dialogs.showTextDialog,
      textBold: dialogs.textBold,
      textFont: dialogs.textFont,
      textInput: dialogs.textInput,
      textItalic: dialogs.textItalic,
      textSize: dialogs.textSize,
    });
    if (!request) return;
    if (typeof document === 'undefined' || !document.fonts?.load) {
      setTextPreviewFontReady(true);
      return;
    }

    let cancelled = false;
    setTextPreviewFontReady(false);
    void document.fonts.load(request.fontSpec, request.sample)
      .then(() => {
        if (!cancelled) setTextPreviewFontReady(true);
      })
      .catch(() => {
        if (!cancelled) setTextPreviewFontReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    dialogs.showTextDialog,
    dialogs.textBold,
    dialogs.textFont,
    dialogs.textInput,
    dialogs.textItalic,
    dialogs.textSize,
    setTextPreviewFontReady,
  ]);

  const handleTextPlaced = useCallback(() => {
    setTextPlacementHint('Tip: Names default to Engrave. Choose Cut only when you want outlines.');
  }, [setTextPlacementHint]);

  const handleRequestTextPlacement = useCallback((world: { x: number; y: number }) => {
    setEditingTextId(null);
    setTextOperationMode('engrave');
    setTextPlacementPt({ x: world.x, y: world.y });
    setShowTextDialog(true);
  }, [setEditingTextId, setShowTextDialog, setTextOperationMode, setTextPlacementPt]);

  const handleEditText = useCallback((obj: SceneObject) => {
    openTextEdit(obj, textOperationModeForObject(scene, obj));
    setTextPlacementPt(null);
    setSelectedIds(new Set([obj.id]));
  }, [openTextEdit, scene, setSelectedIds, setTextPlacementPt]);

  useEffect(() => {
    const onResize = () => setCanvasSize(computeCanvasSize(window.innerWidth, window.innerHeight));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setCanvasSize]);

  // Re-check setup after paint so Electron/localStorage is ready (avoids race with first launch).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        if (!localStorage.getItem(getSetupStorageKey())) {
          setShowSetup(true);
        }
      } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, [setShowSetup]);

  const canUndo = useSceneHistoryStore(s => s.canUndo);
  const canRedo = useSceneHistoryStore(s => s.canRedo);
  const pushHistory = useSceneHistoryStore(s => s.pushHistory);
  const resetHistory = useSceneHistoryStore(s => s.resetHistory);
  const undoHistoryEntry = useSceneHistoryStore(s => s.undoHistoryEntry);
  const redoHistoryEntry = useSceneHistoryStore(s => s.redoHistoryEntry);

  // Push initial scene on mount
  useEffect(() => {
    // T2-78: tag the seed entry so it shows up in the history with a
    // meaningful label rather than the generic 'edit' default.
    resetHistory(scene, { action: 'init' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Central scene-transaction bridge. Dirty state remains hash-derived,
  // frame invalidation is version-based, and preflight still recomputes
  // from scene changes. The debug transition log observes these commits
  // without changing mutation semantics.
  const commitSceneTransaction: CommitSceneTransaction = useMemo(
    () => makeCommitSceneTransaction({
      setScene,
      history: {
        push: pushHistory,
        reset: resetHistory,
      },
      setSelectedIds: (ids) => setSelectedIds(ids),
      notifyDirty: () => { /* dirty is hash-derived; see T2-88 */ },
      // Read through the ref so transaction history sees fresh selection
      // without rebuilding this memo on every click.
      getSelection: () => selectedIdsRef.current,
      invalidate: {
        compile: () => setGcodeStale(true),
        frame: bumpHistoryVersion,
        preflight: () => { /* no-op: see comment above */ },
      },
      transitionLog: {
        emit: (event) => {
          transitionLog.emit(transitionFromSceneTransaction(event));
        },
      },
    }),
    [setGcodeStale, bumpHistoryVersion, pushHistory, resetHistory, setScene, setSelectedIds],
  );
  void commitSceneTransaction;

  // ─── SCENE HANDLERS ──────────────────────────────────────────

  /** Preview: update UI without creating a history entry. */
  const handleSceneChange = useCallback((newScene: Scene) => {
    // T2-76 step 3: dispatch through the unified mutation function.
    // For 'preview' kind, commitSceneTransaction calls setScene only -
    // no history, no dirty flag, no invalidation. Net behavior is
    // identical to the previous direct setScene call.
    commitSceneTransaction(newScene, { kind: 'preview' });
  }, [commitSceneTransaction]);

  /** Commit: update UI AND create a history entry. */
  const handleSceneCommit = useCallback(
    (
      newScene: Scene,
      action: SceneCommitAction = 'unspecified',
      selectionAfter?: ReadonlySet<string>,
    ) => {
      // T2-76 step 3: dispatch through the unified mutation function.
      // T2-76 step 7: the action label is now caller-supplied. Five
      // hook files (useClipboard, useConnectionHandlers,
      // useGeneratorHandlers, useImport, useKerfHandlers) pass
      // meaningful labels per SceneCommitAction. App.tsx's internal
      // callers and other hooks continue to use the 'unspecified'
      // default; future commits can migrate them incrementally.
      //
      // For 'edit' kind, commitSceneTransaction calls setScene,
      // history.push, notifyDirty(true), and invalidate.compile/
      // frame/preflight. The compile and frame invalidations are new
      // on this path since step 3; see the useMemo block above and
      // the T2-76 step 3 commit message for the behavioral diff
      // (notably: edits now reset hasFramed via ConnectionPanelMain's
      // historyVersion watcher, closing a T1-59 frame-before-start
      // gap).
      commitSceneTransaction(
        newScene,
        { kind: 'edit', action },
        selectionAfter ? { selectionAfter } : undefined,
      );
    },
    [commitSceneTransaction],
  );

  const handleAddTextDialogSubmit = useCallback(() => {
    const result = buildTextDialogSceneCommit({
      scene,
      newTextId: generateId(),
      draft: {
        textInput: dialogs.textInput,
        textFont: dialogs.textFont,
        textSize: dialogs.textSize,
        textBold: dialogs.textBold,
        textItalic: dialogs.textItalic,
        textOperationMode: dialogs.textOperationMode,
        editingTextId: dialogs.editingTextId,
        textPlacementPt,
      },
    });
    if (!result) return;

    // T2-79+: atomic - selection of the new/edited text object rides
    // into the history entry's selectionAfter. Undo restores pre-add
    // selection; redo restores the target text selected.
    handleSceneCommit(result.scene, result.action, result.selectionAfter);
    if (result.placedNewText) {
      handleTextPlaced();
    }

    closeTextDialog();
    setTextPlacementPt(null);
    setActiveTool('select');
  }, [
    scene,
    handleSceneCommit,
    dialogs.textInput,
    dialogs.textFont,
    dialogs.textSize,
    dialogs.textBold,
    dialogs.textItalic,
    dialogs.textOperationMode,
    dialogs.editingTextId,
    closeTextDialog,
    setActiveTool,
    setTextPlacementPt,
    textPlacementPt,
    handleTextPlaced,
  ]);

  useEffect(() => {
    handleSceneCommitRef.current = handleSceneCommit;
  }, [handleSceneCommit]);

  const {
    handleConnectionRecompile,
  } = useConnectionHandlers({
    scene,
    handleSceneCommit,
    compileGcode,
    setCurrentGcode,
    connectionSidebarOpen,
    gcodeStale,
    setGcodeStale,
    grbl,
  });

  // T2-6 Phase 3v: derivations delegated to pure helpers.
  const activeLayerMode = useMemo(
    () => deriveActiveLayerMode(scene),
    [scene],
  );

  const interactableLayerIds = useMemo(
    () => deriveInteractableLayerIds(scene),
    [scene],
  );

  const handleModeTabSelect = useCallback(
    (mode: string) => {
      const prev = sceneRef.current;
      const result = buildModeTabSelectResult(prev, mode);

      setSelectedIds(new Set(result.selectionAfter));
      if (result.action) {
        // T2-79+: atomic - selecting all objects on the new mode-layer
        // rides into the history entry's selectionAfter. Undo restores
        // the pre-mode-select selection; redo re-selects the matched
        // objects.
        handleSceneCommit(result.scene, result.action, result.selectionAfter);
        return;
      }

      if (result.scene !== prev) {
        setScene(result.scene);
      }
    },
    [handleSceneCommit, setScene, setSelectedIds],
  );

  const handleActivateLayer = useCallback((layerId: string) => {
    const prev = sceneRef.current;
    const result = buildActivateLayerCommit(prev, layerId);
    if (!result) return;
    // T1-76: route through handleSceneCommit so canvas-click-to-activate
    // and LayerPanel click both produce a history entry. Previously this
    // was handleSceneChange (no history) while LayerPanel.tsx:157 used
    // onSceneCommit — same conceptual action, two policies, audit 4E
    // Critical 9. Active layer is now consistently project state; undo
    // restores it. (Schema-level "active layer is UI state" is the
    // future T2-71/T2-73 path; T1-76 ships the consistency fix today.)
    handleSceneCommit(result.scene, result.action);
  }, [handleSceneCommit]);

  const handleSelectStartMode = useCallback((mode: StartMode, origin: { x: number; y: number }) => {
    setStartMode(mode);
    const result = buildStartModeSelectionCommit(scene, mode, origin);
    handleSceneCommit(result.scene, result.action);
    // When leaving Origin mode, clear any WCS offset that Set Origin
    // applied. Bed mode assumes WCS == machine coords; Head mode is
    // G91-relative and doesn't depend on WCS but users expect the X:Y
    // readout to reflect machine coords after switching. Only 'savedOrigin'
    // mode wants the WCS offset to persist (user will Set Origin manually).
    if (result.shouldResetWcs) {
      void sendResetWcsCommand(grbl.controller);
    }
  }, [scene, handleSceneCommit, grbl.controller, setStartMode]);

  const handleExit = useCallback(async () => {
    const ctrl = grbl.controllerRef.current;
    const plan = buildExitFlowPlan({
      machineStatus: grbl.machineState?.status,
      hasController: Boolean(ctrl),
      controllerJobRunning: Boolean(ctrl?.isJobRunning),
      sceneDirty: isDirty(scene, lastManualSaveHashRef.current),
      electronQuitAvailable: Boolean(window.electronAPI?.quit),
    });

    if (plan.shouldDisconnect && ctrl) {
      if (plan.promptRunningJob) {
        const ok = confirm(
          'A laser job is running!\n\nThe laser will be stopped. Are you sure you want to exit?',
        );
        if (!ok) return;
      }
      await machineUi.executionCoordinator.safeDisconnect();
    }

    if (plan.promptUnsavedChanges) {
      const confirmed = confirm('You have unsaved changes. Are you sure you want to exit?');
      if (!confirmed) return;
    }

    if (plan.destination === 'electron-quit') {
      void window.electronAPI?.quit?.();
      return;
    }

    window.location.href = '/landing.html';
  }, [grbl.controllerRef, grbl.machineState?.status, machineUi.executionCoordinator, scene]);

  const handleCameraPositionDesign = useCallback((worldX: number, worldY: number) => {
    const result = buildCameraPositionCommit(scene, selectedIds, worldX, worldY);
    if (!result) return;
    handleSceneCommit(result.scene, result.action);
  }, [scene, selectedIds, handleSceneCommit]);

  const sceneOps = useSceneOperations({
    scene,
    selectedIds,
    handleSceneCommit,
    setSelectedIds: (ids) => setSelectedIds(ids),
    showAlert,
    showConfirm,
  });

  /**
   * Load a scene as the new project baseline. Resets history, marks
   * clean, clears selection, invalidates compile and frame action.
   *
   * T2-76 step 6: routes through the unified mutation function with
   * kind='load'. The `source` parameter discriminates new-from-blank,
   * file-load, and autosave-recovery for the (currently no-op)
   * transition log; T3-68 will wire the emitter.
   *
   * Behavioral note vs pre-step-6: loading a project now also calls
   * invalidate.compile (was implicit-via-useCompileManager-effect
   * which sidebar-gates, leaving a T1-75-shaped stale-gcode gap on
   * loads) and invalidate.frame (was missing entirely, meaning the
   * T1-59 frame-before-start gate could pass against an outdated
   * frame action after a load). Both close real gaps.
   */
  const handleNewProject = useCallback(
    (newScene: Scene, source: 'file' | 'autosave' | 'new') => {
      lastManualSaveHashRef.current = lastAutosaveHashRef.current = hashSceneForPersistence(newScene);
      commitSceneTransaction(newScene, { kind: 'load', source }, {
        selectionAfter: new Set(),
      });
    },
    [commitSceneTransaction],
  );

  const handleTogglePreview = useCallback(() => {
    setShowToolpathPreview(p => !p);
  }, [setShowToolpathPreview]);

  // Clear preview state only when preview mode is actually off or suppressed by a job.
  useEffect(() => {
    if (shouldClearToolpathPreview({ showToolpathPreview, isJobRunning: grbl.isJobRunning })) {
      setToolpathPreviewMoves(null);
    }
  }, [showToolpathPreview, grbl.isJobRunning, setToolpathPreviewMoves]);

  // Toolpath overlay follows the same `scene` as the canvas (fingerprint includes geometry, layers, transforms).
  useEffect(() => {
    // Never recompile during a running job — main-thread stalls starve the
    // WiFi bridge and cause GRBL's planner buffer to drain, silently stopping
    // the machine mid-job. The auto-recompile effect has this same guard.
    if (!shouldCompileToolpathPreview({ showToolpathPreview, isJobRunning: grbl.isJobRunning })) return;

    let cancelled = false;
    void compileToolpath(scene).then(m => {
      if (cancelled) return;
      if (m === null) {
        void showAlert('No Objects', 'No objects to preview. Add objects to an output layer first.');
        clearToolpathPreview();
        return;
      }
      setToolpathPreviewMoves(m);
    });
    return () => { cancelled = true; };
  }, [showToolpathPreview, sceneCompileTick, scene, compileToolpath, showAlert, grbl.isJobRunning, clearToolpathPreview, setToolpathPreviewMoves]);

  const { clipboard, handleCopy, handlePaste, handleDuplicate } = useClipboard(
    scene,
    selectedIds,
    handleSceneCommit,
  );
  const { handleDragOver, handleDragLeave, handleDrop, handleImageImport } = useImport(scene, {
    handleSceneCommit,
    handleNewProject,
    setIsDragOver,
    showAlert,
    showConfirm,
    showChoice,
  });

  const {
    handleRecover,
    handleWizardComplete,
    handleWizardSkip,
  } = useWizardHandlers({
    scene,
    handleSceneCommit,
    handleNewProject,
    setShowSetup: dialogs.setShowSetup,
    setShowFirstRunGuide: dialogs.setShowFirstRunGuide,
    setShowRecover,
    setRecoverAutosaveTimeLabel,
    viewportActionsRef,
    refreshProfiles,
    showAlert,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      // Skip heavy autosave work during host-streamed jobs; it can drain GRBL's planner.
      if (shouldSkipAutosaveForRunningJob({
        appJobRunning: grbl.isJobRunning,
        controllerJobRunning: Boolean(grbl.controllerRef.current?.isJobRunning),
      })) return;

      let json: string;
      let currentHash: string;
      try {
        currentHash = hashSceneForPersistence(scene);
        if (!shouldPersistAutosaveForHash({
          currentHash,
          lastAutosaveHash: lastAutosaveHashRef.current,
        })) return;
        json = serializeForAutosave(scene);
      } catch (e) {
        console.warn('[LaserForge] Autosave failed (serialize):', e);
        return;
      }

      // Autosave is recovery data; manual dirty prompts keep using lastManualSaveHashRef.
      void writeAutosaveAsync(json).then(
        () => {
          lastAutosaveHashRef.current = currentHash;
        },
        (err: unknown) => {
          console.warn('[LaserForge] Autosave failed:', err);
        },
      );
    }, 30000);

    return () => clearInterval(interval);
  }, [scene, grbl.isJobRunning, grbl.controllerRef]);

  const materialSuggestionRequest = useMemo(
    () => resolveMaterialSuggestionRequest(scene),
    [scene],
  );
  useEffect(() => {
    if (!materialSuggestionRequest) {
      setToastSuggestion(null);
      return;
    }

    let cancelled = false;
    void getSuggestion(
      materialSuggestionRequest.materialName,
      materialSuggestionRequest.machineType,
      materialSuggestionRequest.layerMode,
    ).then(suggestion => {
      if (cancelled) return;
      if (suggestion && suggestion.sampleCount > 0) {
        setToastSuggestion({ suggestion, materialName: materialSuggestionRequest.materialName });
      } else {
        setToastSuggestion(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [materialSuggestionRequest, setToastSuggestion]);

  // ─── UNDO / REDO ─────────────────────────────────────────────

  // T1-75 (origin) + T2-76 step 5 (extension): undo/redo are scene
  // mutations from the perspective of "needs save" and they invalidate
  // any compiled G-code or frame action that was based on the previous
  // scene. The conservative behavior here (always-mark-dirty) is
  // preserved by the unified function's defaults for kind='history'
  // (notifyDirty(true), invalidate.compile, invalidate.frame). The
  // content-hash-based "dirty only if hash changed" model is audit
  // Priority 3, deferred to T2-79.
  //
  // Why pass `direction` explicitly: SceneTransaction's discriminated
  // union pairs kind='history' with direction='undo'|'redo'. The
  // caller knows; this function is the seam where the two paths share
  // behavior, so we surface the parameter rather than hardcode it.
  // Recorded in the debug transition log so undo and redo remain named
  // transitions when inspecting dev state.
  const applyHistoryScene = useCallback(
    (nextScene: Scene, direction: 'undo' | 'redo', selectionAfter?: ReadonlySet<string>) => {
      commitSceneTransaction(
        nextScene,
        { kind: 'history', direction },
        selectionAfter ? { selectionAfter } : undefined,
      );
    },
    [commitSceneTransaction],
  );

  // T2-83: undo / redo are blocked while a job is streaming. Pre-T2-83
  // the user could undo design changes mid-burn, leaving the visible
  // scene desynced from what the controller was actually executing —
  // the active job context was already pinned (T2-53 work) but the
  // scene display drifted. Refusing the keystroke is the simplest
  // safety: the user must stop the job before editing the design.
  // Option B (separate "design state" undo lane while job continues)
  // is filed under T2-53's full implementation.
  const handleUndo = useCallback(() => {
    if (grbl.isJobRunning) {
      void showAlert(
        'Undo blocked',
        'A job is running. Stop the job before editing the design.',
      );
      return;
    }
    const entry = undoHistoryEntry();
    if (!entry) return;
    const result = buildHistoryNavigationCommit(entry, 'undo');
    applyHistoryScene(result.scene, result.direction, result.selectionAfter);
  }, [applyHistoryScene, grbl.isJobRunning, showAlert, undoHistoryEntry]);

  const handleRedo = useCallback(() => {
    if (grbl.isJobRunning) {
      void showAlert(
        'Redo blocked',
        'A job is running. Stop the job before editing the design.',
      );
      return;
    }
    const entry = redoHistoryEntry();
    if (!entry) return;
    const result = buildHistoryNavigationCommit(entry, 'redo');
    applyHistoryScene(result.scene, result.direction, result.selectionAfter);
  }, [applyHistoryScene, grbl.isJobRunning, showAlert, redoHistoryEntry]);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(selectAllSelectableIds(scene));
  }, [scene, setSelectedIds]);

  const handleDelete = useCallback(() => {
    const result = buildDeleteSelectionCommit(scene, selectedIds);
    if (!result) return;
    // T1-73 (origin) + T2-76 step 4 (extension): route through the
    // unified mutation function with the 'delete' action label and an
    // explicit empty selection. selectionAfter is applied inside
    // commitSceneTransaction so the selection-clear is part of the
    // same transaction as the scene replacement (matches the
    // function's documented contract; see SceneTransaction.ts step 5
    // of dispatch). T1-73's original concern (autosave skipping the
    // deletion if the project stayed clean) is still satisfied:
    // commitSceneTransaction calls notifyDirty(true) for kind='edit'.
    commitSceneTransaction(result.scene, { kind: 'edit', action: result.action }, {
      selectionAfter: result.selectionAfter,
    });
  }, [scene, selectedIds, commitSceneTransaction]);

  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu(
    scene,
    selectedIds,
    productionMode,
    {
      handleSceneCommit,
      setSelectedIds: (ids: Set<string>) => setSelectedIds(ids),
      setActiveTool: (t: string) => setActiveTool(t as ToolType),
      handleCopy,
      handlePaste,
      handleDuplicate,
      handleDelete,
      setShowTextDialog: dialogs.setShowTextDialog,
      setEditingTextId: dialogs.setEditingTextId,
      setTextInput: dialogs.setTextInput,
      setTextFont: dialogs.setTextFont,
      setTextSize: dialogs.setTextSize,
      setTextBold: dialogs.setTextBold,
      setTextItalic: dialogs.setTextItalic,
      setTextOperationMode: dialogs.setTextOperationMode,
      setTextPlacementPt,
      setShowVariableText: dialogs.setShowVariableText,
      setVariableTextSource: dialogs.setVariableTextSource,
      alignObjects: sceneOps.alignObjects,
      centerOnCanvas: sceneOps.centerOnCanvas,
      performBoolean: sceneOps.performBoolean,
      offsetSelected: sceneOps.offsetSelected,
      convertTextToPath: sceneOps.convertTextToPath,
      showAlert,
      showPrompt,
      distributeObjects: sceneOps.distributeObjects,
      openGridArray: () => setShowGridArray(true),
      openMaterialTest: () => {
        if (gatedFeature('material_test')) setShowMaterialTest(true);
      },
      openKerfWizard: () => {
        if (gatedFeature('kerf_wizard')) setShowKerfWizard(true);
      },
      moveToCorner: sceneOps.moveToCorner,
      moveToMaterialOrigin: sceneOps.moveToMaterialOrigin,
      rotateSelected: sceneOps.rotateSelected,
      flipSelected: sceneOps.flipSelected,
      toggleLock: sceneOps.toggleLock,
      toggleVisibility: sceneOps.toggleVisibility,
    },
  );

  const {
    syncAutosaveAfterFileSave,
    handleKeyboardSave,
    handleKeyboardOpen,
    handleKeyboardNew,
    handleClearSelection,
  } = useFileHandlers({
    scene,
    setSelectedIds,
    handleNewProject,
    isSceneDirty: () => isDirty(scene, lastManualSaveHashRef.current),
    markSceneSaved: (savedScene) => {
      lastManualSaveHashRef.current = lastAutosaveHashRef.current = hashSceneForPersistence(savedScene);
    },
    showAlert,
    showConfirm,
  });

  const {
    handleQuickActionDuplicate,
    handleQuickActionDelete,
    handleQuickActionCenter,
  } = useQuickActionHandlers({
    scene,
    selectedIds,
    setSelectedIds,
    handleSceneCommit,
    handleDelete,
    centerOnMaterial: sceneOps.centerOnMaterial,
  });

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY);
    },
    [showContextMenu],
  );

  useEffect(() => {
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  const handleConnect = useCallback(async () => {
    dialogs.setShowConnection(true);
  }, [dialogs]);

  const handleToolbarDisconnect = useCallback(async () => {
    try {
      await machineUi.executionCoordinator.safeDisconnect({ skipStop: true });
    } catch { /* best effort */ }
    dialogs.setShowConnection(false);
  }, [machineUi.executionCoordinator, dialogs]);

  const {
    handleGridArray,
    handleGridArrayConfirm,
    handleNestingApply,
    handleBoxGenerate,
    handleVariableTextGenerate,
    handleTemplateSelect,
    openBoxStudio,
    closeBoxStudio,
    handleBoxStudioGenerate,
  } = useAppGeneratorWorkflows({
    scene,
    selectedIds,
    setSelectedIds,
    handleSceneCommit,
    setShowGridArray,
    setGridArrayBounds,
    setShowTemplates: dialogs.setShowTemplates,
    showAlert,
    setShowBoxStudio,
  });

  const {
    handleMaterialTestApply,
    handleCalibrationGridEmitted,
    handleCalibrationCurveReady,
    handleKerfGenerateTest,
    handleKerfApply,
    handleKerfSaveToPreset,
    handleMaterialConfirm,
    handleMaterialClear,
    handleMaterialPresetApply,
  } = useAppMaterialWorkflows({
    scene,
    handleSceneCommit,
    showAlert,
    setShowMaterial: dialogs.setShowMaterial,
    setLastCalibrationGridResult,
    refreshProfiles,
  });

  const { handleNudge } = useAppNudgeWorkflow({
    scene,
    selectedIds,
    handleSceneChange,
    handleSceneCommit,
  });

  useAppKeyboardWorkflow({
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
    setShowShortcuts: dialogs.setShowShortcuts,
    selectedIds,
    clipboardItemCount: clipboard.length,
    sceneOps,
  });

  const hasSelectedText = scene.objects.some(o =>
    selectedIds.has(o.id) && o.geometry.type === 'text'
  );

  // ─── RENDER ──────────────────────────────────────────────────

  if (showBoxStudio) {
    return React.createElement(BoxStudioPage, {
      scene,
      onGenerate: handleBoxStudioGenerate,
      onBack: closeBoxStudio,
    });
  }

  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      height: '100vh',
      background: theme.bg.base,
      color: '#ccc',
      fontFamily: 'monospace',
      position: 'relative' as const,
    },
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  },
    isDragOver && React.createElement(AppDragDropOverlay),

    React.createElement(FileToolbar, buildAppFileToolbarProps({
      scene,
      compileGcode,
      onSceneChange: handleSceneChange,
      onSceneCommit: handleSceneCommit,
      onNewProject: handleNewProject,
      onAfterSuccessfulFileSave: syncAutosaveAfterFileSave,
      showAlert,
      showConfirm,
      showChoice,
      onConnect: handleConnect,
      onDisconnect: handleToolbarDisconnect,
      onSetup: () => dialogs.setShowSetup(true),
      onMaterialTest: () => {
        if (gatedFeature('material_test')) setShowMaterialTest(true);
      },
      onCalibrateMaterial: () => setShowCalibrateMaterial(true),
      onMaterialSetup: () => dialogs.setShowMaterial(true),
      onMaterialLibrary: () => setShowMaterialLibrary(true),
      onCamera: () => setShowCamera(true),
      onImportImageFile: handleImageImport,
      onTemplates: () => dialogs.setShowTemplates(true),
      onBoxGenerator: () => {
        dialogs.setShowBoxGenerator(true);
      },
      onAutoNest: () => {
        if (gatedFeature('nesting')) {
          setShowNesting(true);
        }
      },
      onKerfWizard: () => {
        if (gatedFeature('kerf_wizard')) setShowKerfWizard(true);
      },
      onPreviewToggle: togglePreviewMode,
      previewMode,
      onUndo: handleUndo,
      onRedo: handleRedo,
      canUndo,
      canRedo,
      projectName: scene.metadata?.name,
      isConnected: toolbarLaserConnected,
      materialName: scene.material?.name ?? null,
      onShowShortcuts: () => dialogs.setShowShortcuts(true),
      productionMode,
      onToggleProductionMode: handleToggleProductionMode,
      onExit: handleExit,
      onTogglePreview: handleTogglePreview,
      showToolpathPreview,
      machineMaxSpindle: grbl.controller?.maxSpindle ?? 1000,
      machineBedWidth: resolvedMachineBedWidthMm,
      machineBedHeight: resolvedMachineBedHeightMm,
      onOpenSettings: (tab?: SettingsTab) => {
        openSettings(tab);
      },
    })),

    React.createElement(AppRecoverySetup, {
      showRecover,
      showSetup: dialogs.showSetup,
      recoverAutosaveTimeLabel,
      onRecover: handleRecover,
      onDismissRecover: () => {
        setShowRecover(false);
        setRecoverAutosaveTimeLabel(null);
        clearAutosave();
      },
      onWizardComplete: handleWizardComplete,
      onWizardSkip: handleWizardSkip,
      initialBedWidth: activeProfile?.bedWidth ?? scene.canvas.width,
      initialBedHeight: activeProfile?.bedHeight ?? scene.canvas.height,
      initialMaterialType: scene.material?.type,
      initialMaterialName: scene.material?.name,
      initialMaterialColor: scene.material?.color,
      initialMaterialWidth: scene.material?.width,
      initialMaterialHeight: scene.material?.height,
      initialMaterialThickness: scene.material?.thickness,
      initialMachineName: scene.machine?.name,
      initialMachineWatts: scene.machine?.watts,
      initialMachineType: scene.machine?.type,
      initialOriginCorner: activeProfile?.originCorner,
      initialHomeCorner: activeProfile?.homeCorner,
      initialHomingEnabled: activeProfile?.homingEnabled,
      initialMaxSpindle: activeProfile?.maxSpindle,
    }),
    React.createElement(AppFirstRunGuideBridge, {
      scene,
      onSceneCommit: handleSceneCommit,
    }),

    React.createElement('div', {
      style: { flex: 1, overflow: 'hidden', display: 'flex' },
    },
      React.createElement(ToolBar, {
        activeTool,
        onToolChange: setActiveTool,
      }),
      React.createElement('div', {
        style: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minWidth: 0 },
      },
        // ── Material toolbar ──────────────────────────────
        React.createElement(MaterialBar, {
          ref: materialBarRef,
          scene,
          zoomLevel,
          onZoomIn: () => viewportActionsRef.current?.zoomIn(),
          onZoomOut: () => viewportActionsRef.current?.zoomOut(),
          onFitToBed: () => viewportActionsRef.current?.fitToBed(),
          onClearMaterial: () => handleSceneCommit({ ...scene, material: null }, 'material-clear'),
          onApplyPreset: handleMaterialPresetApply,
          onOpenMaterialLibrary: () => setShowMaterialLibrary(true),
        }),
        // ── Canvas viewport ───────────────────────────────
        React.createElement('div', {
          style: { flex: 1, position: 'relative' as const, overflow: 'hidden' },
          onClick: () => materialBarRef.current?.closeDropdown(),
        },
          React.createElement('div', {
            style: {
              position: 'absolute',
              top: 6,
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: 10,
              fontFamily: theme.font.mono,
              color: '#8888aa',
              background: 'rgba(10, 10, 20, 0.75)',
              padding: '3px 10px',
              borderRadius: 4,
              border: '1px solid #1a1a2e',
              pointerEvents: 'none',
              zIndex: 5,
            },
          },
          resolveStartModeStatusLabel({ mode: startMode, savedOrigin }),
          ),
          React.createElement(CanvasViewport, buildAppCanvasViewportProps({
          scene,
          activeTool: activeTool,
          width: canvasViewportWidth,
          height: canvasSize.height,
          selectedIds: selectedIds,
          onSelectionChange: setSelectedIds,
          onSceneChange: handleSceneChange,
          onSceneCommit: handleSceneCommit,
          actionsRef: viewportActionsRef,
          onZoomChange: setZoomLevel,
          previewMode,
          quickActions: !previewMode ? {
            enabled: true,
            selectedCount: selectedIds.size,
            onDuplicate: handleQuickActionDuplicate,
            onDelete: handleQuickActionDelete,
            onCenter: handleQuickActionCenter,
            onGridArray: handleGridArray,
            hasSelectedText,
            handleTextToPath: () => { void sceneOps.textToPath(); },
          } : undefined,
          onRequestTextPlacement: handleRequestTextPlacement,
          onActiveTool: setActiveTool,
          onEditText: handleEditText,
          livePosition: liveJobCanvasPosition,
          isJobRunning: grbl.isJobRunning,
          jobProgress: grbl.jobProgress,
          activeJobMoves,
          showToolpathPreview,
          toolpathMoves: showToolpathPreview ? toolpathPreviewMoves : null,
          machineWorkAreaMm: machineBedFromGrbl,
          startMode,
          savedOrigin,
          bedWidthMm: resolvedMachineBedWidthMm,
          bedHeightMm: resolvedMachineBedHeightMm,
          originCorner: activeProfile?.originCorner ?? 'front-left',
          onViewportLayout: handleViewportLayout,
          interactableLayerIds,
          onActivateLayer: handleActivateLayer,
          burnState: machineUi.burnState,
        })),
          React.createElement(ModeTabsOverlay, {
            viewportX: bedTabLayout.bedScreenX,
            viewportY: bedTabLayout.bedScreenY,
            viewportZoom: bedTabLayout.zoom,
            activeMode: activeLayerMode,
            onSelectMode: handleModeTabSelect,
            bedWidth: resolvedMachineBedWidthMm,
            bedHeight: resolvedMachineBedHeightMm,
          }),
        ),
      ),
      connectionSidebarOpen && React.createElement(ConnectionPanel, buildAppConnectionPanelProps({
        controller: grbl.controller!,
        portRef: grbl.portRef,
        machineState: grbl.machineState,
        jobProgress: grbl.jobProgress,
        scene,
        sidebarWidth: connectionSidebarWidth,
        productionMode,
        userMode,
        gcode: currentGcode,
        compiledJobTicket: lastResult?.ticket ?? null,
        lastGcodeCompileResult: lastResult,
        onClose: () => dialogs.setShowConnection(false),
        onDisconnect: () => dialogs.setShowConnection(false),
      onOpenSettings: (tab?: SettingsTab) => {
        openSettings(tab);
      },
        bedWidth: resolvedMachineBedWidthMm,
        bedHeight: resolvedMachineBedHeightMm,
        // T1-218 (v30 audit #1): pass through so preflight can fire
        // MISSING_BED_SIZE when neither controller nor profile knows
        // the bed, instead of accepting the 300mm fallback as truth.
        bedDimensionsKnown: resolvedMachineBedDimensionsKnown,
        // T1-100: activeJobTransform is populated only after Start, so
        // pre-Start preflight should use the current fresh compile bounds
        // instead of falling back to fragile raw G-code text scanning.
        machinePlanBounds:
          activeJobTransform?.plan.bounds
          ?? (!gcodeStale && currentGcode && lastResult ? lastResult.machinePlanBounds : null),
        boundsMinX: Number.isFinite(sceneBounds.minX) ? sceneBounds.minX : 0,
        boundsMinY: Number.isFinite(sceneBounds.minY) ? sceneBounds.minY : 0,
        boundsMaxX: Number.isFinite(sceneBounds.maxX) ? sceneBounds.maxX : 100,
        boundsMaxY: Number.isFinite(sceneBounds.maxY) ? sceneBounds.maxY : 100,
        frameTransformBoundsMinX: Number.isFinite(frameTransformBounds.minX) ? frameTransformBounds.minX : 0,
        frameTransformBoundsMinY: Number.isFinite(frameTransformBounds.minY) ? frameTransformBounds.minY : 0,
        frameTransformBoundsMaxX: Number.isFinite(frameTransformBounds.maxX) ? frameTransformBounds.maxX : 100,
        frameTransformBoundsMaxY: Number.isFinite(frameTransformBounds.maxY) ? frameTransformBounds.maxY : 100,
        showAlert,
        showConfirm,
        showPrompt,
        onSceneCommit: handleSceneCommit,
        startMode,
        savedOrigin,
        originCorner: activeProfile?.originCorner ?? 'front-left',
        activeProfile,
        machinePosition: machinePositionForStartWizard,
        onSelectMode: (mode) => handleSelectStartMode(mode, machinePositionForStartWizard ?? scene.startPosition),
        onSaveOrigin: handleSaveOrigin,
        gcodeStale,
        isCompiling,
        compileProgress,
        isCompileCancelling,
        onCancelCompile: cancelCompile,
        historyVersion,
        onRecompile: handleConnectionRecompile,
        machineUi,
      })),
      !connectionSidebarOpen && React.createElement('div', {
        style: {
          width: 240,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column' as const,
          borderLeft: '1px solid #1a1a30',
          background: '#0c0c18',
          height: '100%',
          overflow: 'hidden',
        },
      },
        React.createElement(LayerPanel, {
          scene,
          selectedIds,
          onSceneCommit: handleSceneCommit,
          productionMode,
          onSceneChange: handleSceneChange,
          onSelectionChange: setSelectedIds,
          showAlert,
          handleTextToPath: () => void sceneOps.textToPath(),
          onEditText: handleEditText,
        }),
      ),
    ),

    React.createElement(UpdateNotice, {
      isJobRunning: grbl.isJobRunning,
    }),

    React.createElement(StatusFooter, {
      scene,
      zoomLevel,
      productionMode,
      textPlacementHint,
      onZoomIn: () => viewportActionsRef.current?.zoomIn(),
      onZoomOut: () => viewportActionsRef.current?.zoomOut(),
      onFitToBed: () => viewportActionsRef.current?.fitToBed(),
    }),

    contextMenu && React.createElement(ContextMenu, {
      x: contextMenu.x,
      y: contextMenu.y,
      onClose: hideContextMenu,
      items: contextMenu.items,
    }),

    showGridArray && React.createElement(GridArrayDialog, {
      sourceWidth: gridArrayBounds.w,
      sourceHeight: gridArrayBounds.h,
      onConfirm: handleGridArrayConfirm,
      onCancel: () => setShowGridArray(false),
    }),

    showMaterialTest && React.createElement(MaterialTestDialog, {
      scene,
      onApply: handleMaterialTestApply,
      onClose: () => setShowMaterialTest(false),
    }),

    React.createElement(CalibrateMaterialDialog, {
      isOpen: showCalibrateMaterial,
      onClose: () => setShowCalibrateMaterial(false),
      onGridEmitted: handleCalibrationGridEmitted,
      onCurveReady: handleCalibrationCurveReady,
      initialResult: lastCalibrationGridResult,
      initialStage: lastCalibrationGridResult ? 'burn' : 'configure',
    }),

    showKerfWizard && React.createElement(KerfWizard, {
      scene,
      selectedIds,
      onGenerateTestPiece: handleKerfGenerateTest,
      onApplyKerf: handleKerfApply,
      onSaveToPreset: handleKerfSaveToPreset,
      onClose: () => setShowKerfWizard(false),
    }),

    showNesting && React.createElement(NestingDialog, {
      scene,
      onApply: handleNestingApply,
      onClose: () => setShowNesting(false),
    }),

    dialogs.showVariableText && dialogs.variableTextSource && React.createElement(VariableTextDialog, {
      scene,
      sourceObject: dialogs.variableTextSource,
      onGenerate: handleVariableTextGenerate,
      onClose: () => dialogs.closeVariableText(),
    }),

    gcodePreview && React.createElement(GcodePreview, {
      gcode: gcodePreview,
      bedWidth: resolvedMachineBedWidthMm,
      bedHeight: resolvedMachineBedHeightMm,
      onClose: () => setGcodePreview(null),
    }),

    dialogs.showMaterial && React.createElement(MaterialDialog, {
      bedWidth: resolvedMachineBedWidthMm,
      bedHeight: resolvedMachineBedHeightMm,
      current: scene.material ? { type: scene.material.type, name: scene.material.name, width: scene.material.width, height: scene.material.height, thickness: scene.material.thickness } : null,
      onConfirm: handleMaterialConfirm,
      onClear: handleMaterialClear,
      onCancel: () => dialogs.setShowMaterial(false),
    }),

    showMaterialLibrary && React.createElement(MaterialLibraryDialog, {
      scene,
      onClose: () => setShowMaterialLibrary(false),
      onMaterialApplied: bumpMaterialLibraryRevision,
    }),

    showCamera && React.createElement(CameraDialog, {
      scene,
      onClose: () => setShowCamera(false),
      onPositionDesign: handleCameraPositionDesign,
    }),

    dialogs.showTemplates && React.createElement(TemplateBrowser, {
      onSelect: handleTemplateSelect,
      onClose: () => dialogs.setShowTemplates(false),
    }),

    dialogs.showBoxGenerator && React.createElement(BoxGenerator, {
      scene,
      onGenerate: handleBoxGenerate,
      onClose: () => dialogs.setShowBoxGenerator(false),
      onOpenStudio: openBoxStudio,
    }),

    dialogs.showShortcuts && React.createElement(ShortcutsPanel, {
      onClose: () => dialogs.setShowShortcuts(false),
    }),

    React.createElement(AppSettingsModal, {
      open: settingsOpen,
      onClose: closeSettings,
      initialTab: settingsInitialTab,
      activeProfile,
      onUpdateProfile: updateActiveProfile,
      canAutoDetect: !!grblMachineInfo,
      liveCapabilities: settingsLiveCapabilities,
      onAutoDetect: handleAutoDetectMachine,
      onReRunSetup: () => {
        closeSettings();
        dialogs.setShowSetup(true);
      },
      profiles: allProfiles,
      activeProfileId,
      onSetActiveProfile: setActiveProfileAndApply,
      onCreateProfileFromCurrentScene: createProfileFromCurrentScene,
      onUpdateCurrentFromScene: updateCurrentProfileFromScene,
      onDeleteProfile: deleteProfileAndClearActive,
      onShowFontCredits: () => setShowFontCredits(true),
      userMode,
      onSetUserMode: handleSetUserMode,
    }),

    toastSuggestion && React.createElement(LearnedToast, {
      suggestion: toastSuggestion.suggestion,
      materialName: toastSuggestion.materialName,
      onApply: (power, speed, passes) => {
        const activeLayer = scene.layers.find(l => l.id === scene.activeLayerId);
        if (!activeLayer) return;
        const newLayers = scene.layers.map(l =>
          l.id === activeLayer.id
            ? {
                ...l,
                settings: {
                  ...l.settings,
                  power: { ...l.settings.power, max: power },
                  speed,
                  passes,
                },
              }
            : l
        );
        handleSceneCommit({ ...scene, layers: newLayers }, 'learned-toast-apply');
      },
      onDismiss: () => setToastSuggestion(null),
    }),

    React.createElement(AppTextDialogs, {
      textDialog: {
        showTextDialog: dialogs.showTextDialog,
        editingTextId: dialogs.editingTextId,
        textInput: dialogs.textInput,
        textFont: dialogs.textFont,
        textSize: dialogs.textSize,
        textBold: dialogs.textBold,
        textItalic: dialogs.textItalic,
        textOperationMode: dialogs.textOperationMode,
        textPreviewFontReady,
        setTextInput: dialogs.setTextInput,
        setTextFont: dialogs.setTextFont,
        setTextSize: dialogs.setTextSize,
        setTextBold: dialogs.setTextBold,
        setTextItalic: dialogs.setTextItalic,
        setTextOperationMode: dialogs.setTextOperationMode,
        onClose: () => {
          dialogs.closeTextDialog();
          setTextPlacementPt(null);
        },
        onSubmit: handleAddTextDialogSubmit,
        onShowFontCredits: () => setShowFontCredits(true),
      },
      showFontCredits,
      onCloseFontCredits: () => setShowFontCredits(false),
    }),

    modal && React.createElement(AppModal, {
      key: `${modal.variant}-${modal.title}`,
      title: modal.title,
      message: modal.message,
      details: modal.details,
      onClose: dismissModal,
      prompt: modal.variant === 'prompt'
        ? { defaultValue: modal.defaultValue, placeholder: modal.placeholder }
        : undefined,
      onPromptSubmit: modal.variant === 'prompt' ? (v: string) => finishPrompt(v) : undefined,
      confirmWithCheckbox: modal.variant === 'confirmWithCheckbox'
        ? { label: modal.checkboxLabel, onResult: finishConfirmWithCheckbox }
        : undefined,
      buttons: modal.variant === 'alert'
        ? [{ label: 'OK', action: finishAlert, primary: true }]
        : modal.variant === 'choice'
          ? modal.choices.map(choice => ({
              label: choice.label,
              action: () => finishChoice(choice.value),
              primary: choice.primary,
              color: choice.color,
            }))
        : modal.variant === 'confirm'
          ? [
              { label: 'Cancel', action: () => finishConfirm(false) },
              { label: 'OK', action: () => finishConfirm(true), primary: true },
            ]
          : modal.variant === 'confirmWithCheckbox'
            ? []
            : [
                { label: 'Cancel', action: () => finishPrompt(null) },
                { label: 'OK', action: () => {}, primary: true },
              ],
    }),
  );
}
