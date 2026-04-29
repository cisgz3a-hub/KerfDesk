/**
 * === FILE: /src/ui/components/App.tsx ===
 *
 * Purpose:    Root application component. Owns the Scene state,
 *             integrates HistoryManager for undo/redo, and wires
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
 *   - /src/ui/history/HistoryManager.ts
 *   - /src/ui/components/FileToolbar.tsx
 *   - /src/ui/components/CanvasViewport.tsx
 * Last updated: UI Wiring — App Shell
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { type Scene, createScene } from '../../core/scene/Scene';
import { deleteObjects } from '../../core/scene/SceneOps';
import { HistoryManager } from '../history/HistoryManager';
import { makeCommitSceneTransaction, type CommitSceneTransaction } from '../scene/SceneTransaction';
import { type SceneCommitAction } from '../scene/SceneCommitActions';
import { FileToolbar } from './FileToolbar';
import { AppModal } from './AppModal';
import { useModal } from '../hooks/useModal';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useClipboard } from '../hooks/useClipboard';
import { useImport } from '../hooks/useImport';
import { useCompileManager } from '../hooks/useCompileManager';
import { useConnectionHandlers } from '../hooks/useConnectionHandlers';
import { useWizardHandlers, getSetupStorageKey } from '../hooks/useWizardHandlers';
import { useQuickActionHandlers } from '../hooks/useQuickActionHandlers';
import { useFileHandlers } from '../hooks/useFileHandlers';
import { useMaterialHandlers } from '../hooks/useMaterialHandlers';
import { useGeneratorHandlers } from '../hooks/useGeneratorHandlers';
import { useKerfHandlers } from '../hooks/useKerfHandlers';
import { useMaterialTestHandlers } from '../hooks/useMaterialTestHandlers';
import { type MachineTransformResult } from '../../core/plan/MachineTransform';
import { type Move } from '../../core/plan/Plan';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDialogs } from '../hooks/useDialogs';
import { useSceneOperations } from '../hooks/useSceneOperations';
import { useControllerConnection } from '../hooks/useControllerConnection';
import { useMachineService } from '../hooks/useMachineService';
import { GrblController } from '../../controllers/grbl/GrblController';
import { CanvasViewport, type ViewportActions } from './CanvasViewport';
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
import { generateId, IDENTITY_MATRIX } from '../../core/types';
import { createLayer, type LayerMode } from '../../core/scene/Layer';
import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { theme } from '../styles/theme';
import { WelcomeWizard } from './WelcomeWizard';
import { ShortcutsPanel } from './ShortcutsPanel';
import { ConnectionPanel } from './ConnectionPanel';
import { TemplateBrowser } from './TemplateBrowser';
import { BoxGenerator } from './BoxGenerator';
import { NestingDialog } from './NestingDialog';
import { MaterialLibraryDialog } from './MaterialLibraryDialog';
import { CameraDialog } from './CameraDialog';
import { KerfWizard } from './KerfWizard';
import { VariableTextDialog } from './VariableTextDialog';
import { AddTextDialog } from './AddTextDialog';
import { FontCreditsDialog } from './FontCreditsDialog';
import { StatusFooter } from './StatusFooter';
import { MaterialBar, type MaterialBarHandle } from './MaterialBar';
import { CalibrateMaterialDialog } from './materials/CalibrateMaterialDialog';
import { LearnedToast } from './LearnedToast';
import { getSuggestion, type MaterialSuggestion } from '../../core/materials/MaterialFeedback';
import { type CalibrationGridResult } from '../../core/materials/CalibrationGrid';
import { type ResponseCurve } from '../../core/materials/ResponseCurve';
import {
  getPresets,
  savePreset,
  migrateDeviceProfileResponseCurves,
  initializeMaterialLibrary,
} from '../../core/materials/MaterialLibrary';
import type { MaterialPreset } from '../../core/materials/MaterialPreset';
import { initializeMaterialPresets } from '../../core/materials/MaterialPresets';
import { BUNDLED_FONTS } from '../../fonts/fontRegistry';
import { injectBundledFontFaces } from '../../fonts/injectFontFaces';
import { SettingsModal, type SettingsTab } from './SettingsModal';
import {
  deleteDeviceProfile,
  getActiveProfile,
  getActiveProfileId,
  getDeviceProfiles,
  initializeDeviceProfiles,
  profileFromScene,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../../core/devices/DeviceProfile';
import { MachineSettingsTab } from './settings/MachineSettingsTab';
import { GcodeSettingsTab } from './settings/GcodeSettingsTab';
import { CalibrationSettingsTab } from './settings/CalibrationSettingsTab';
import { ProfilesSettingsTab } from './settings/ProfilesSettingsTab';
import { entitlementService, tierDisplayName } from '../../entitlements';
import { type GcodeStartMode } from '../../core/output/GcodeOrigin';
import { resolveBedHeightMm, resolveBedWidthMm } from '../../app/PipelineService';

type StartMode = GcodeStartMode;
import { gatedFeature, isProUnlocked } from '../utils/proGate';

// ─── COMPONENT ───────────────────────────────────────────────────

function filterValidIds(ids: ReadonlySet<string>, scene: Scene): Set<string> {
  if (ids.size === 0) return new Set();
  const sceneIds = new Set(scene.objects.map(o => o.id));
  const valid = new Set<string>();
  for (const id of ids) {
    if (sceneIds.has(id)) valid.add(id);
  }
  return valid;
}

export function App() {
  const {
    modal,
    showAlert,
    showConfirm,
    showConfirmWithCheckbox,
    showPrompt,
    dismissModal,
    finishAlert,
    finishConfirm,
    finishConfirmWithCheckbox,
    finishPrompt,
  } = useModal();
  const dialogs = useDialogs();
  const [zoomLevel, setZoomLevel] = useState(100);
  const viewportActionsRef = useRef<ViewportActions | null>(null);
  const materialBarRef = useRef<MaterialBarHandle | null>(null);

  // Load bundled fonts into browser font lookup so dialog/preview canvas text
  // resolves families like "Inter" instead of falling back to a default serif.
  useEffect(() => {
    void injectBundledFontFaces();
  }, []);

  const [scene, setScene] = useState<Scene>(() => {
    const initial = createScene(400, 300, 'Untitled');
    return initial;
  });
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const sceneBounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of scene.objects) {
      if (!obj.visible) continue;
      const b = computeObjectBounds(obj);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    return { minX, minY, maxX, maxY };
  }, [scene.objects]);

  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight - 34 });
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // T2-78: ref-shadow of selectedIds so SceneTransaction's getSelection
  // dep can read the freshest value without rebuilding the useMemo on
  // every selection change. Synced via the useEffect below.
  const selectedIdsRef = useRef<ReadonlySet<string>>(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [isDragOver, setIsDragOver] = useState(false);
  const [showGridArray, setShowGridArray] = useState(false);
  const [showNesting, setShowNesting] = useState(false);
  const [gridArrayBounds, setGridArrayBounds] = useState({ w: 0, h: 0 });
  const [showMaterialTest, setShowMaterialTest] = useState(false);
  const [showCalibrateMaterial, setShowCalibrateMaterial] = useState(false);
  const [showMaterialLibrary, setShowMaterialLibrary] = useState(false);
  const [materialLibraryRev, setMaterialLibraryRev] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [showKerfWizard, setShowKerfWizard] = useState(false);
  const [showFontCredits, setShowFontCredits] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('machine');
  const [profileRevision, setProfileRevision] = useState(0);
  const [startMode, setStartMode] = useState<StartMode>(() => {
    try {
      const raw = localStorage.getItem('laserforge_start_mode');
      if (raw === 'absolute' || raw === 'current' || raw === 'savedOrigin') return raw;
    } catch { /* ignore */ }
    return 'absolute';
  });
  const [savedOrigin, setSavedOrigin] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem('laserforge_saved_origin');
      return raw ? JSON.parse(raw) as { x: number; y: number } : null;
    } catch {
      return null;
    }
  });
  const startModeRef = useRef(startMode);
  startModeRef.current = startMode;
  const [gcodePreview, setGcodePreview] = useState<string | null>(null);
  const [showToolpathPreview, setShowToolpathPreview] = useState(false);
  const [toolpathPreviewMoves, setToolpathPreviewMoves] = useState<readonly Move[] | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [bedTabLayout, setBedTabLayout] = useState({
    bedScreenX: 0,
    bedScreenY: 0,
    zoom: 1.5,
  });
  const handleViewportLayout = useCallback((layout: { bedScreenX: number; bedScreenY: number; zoom: number }) => {
    setBedTabLayout(prev => {
      if (
        prev.bedScreenX === layout.bedScreenX &&
        prev.bedScreenY === layout.bedScreenY &&
        prev.zoom === layout.zoom
      ) {
        return prev;
      }
      return layout;
    });
  }, []);

  const [activeJobMoves, setActiveJobMoves] = useState<readonly Move[] | null>(null);
  const [activeJobPlanBounds, setActiveJobPlanBounds] = useState<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);
  const [activeJobTransform, setActiveJobTransform] = useState<MachineTransformResult | null>(null);
  const grbl = useControllerConnection('grbl');
  const machineUi = useMachineService({
    controllerRef: grbl.controllerRef,
    portRef: grbl.portRef,
  });
  const wasJobRunningRef = useRef(false);

  const machinePositionForStartWizard = useMemo(() => {
    const s = grbl.machineState;
    if (!s || s.status === 'disconnected' || s.status === 'connecting') return null;
    return { x: s.position.x, y: s.position.y };
  }, [grbl.machineState]);

  const liveJobCanvasPosition = useMemo(() => {
    if (!grbl.isJobRunning) return null;
    const s = grbl.machineState;
    if (!s || s.status === 'disconnected' || s.status === 'connecting') return null;
    const wp = s.position;
    if (activeJobTransform) {
      const canvasX = wp.x - activeJobTransform.offsetX;
      const canvasY = activeJobTransform.flipY
        ? activeJobTransform.flipReferenceY - wp.y + activeJobTransform.offsetY
        : wp.y - activeJobTransform.offsetY;
      return { x: canvasX, y: canvasY };
    }
    return { x: wp.x, y: wp.y };
  }, [grbl.isJobRunning, grbl.machineState, activeJobTransform]);

  const connectionSidebarOpen = dialogs.showConnection && grbl.controllerReady;

  // Read bed scalars each render; memoize the {width,height} object by value only so
  // GRBL status polls (new machineState references) do not churn object identity.
  const _bedWidth =
    grbl.controller instanceof GrblController ? grbl.controller.getMachineInfo().bedWidth : 0;
  const _bedHeight =
    grbl.controller instanceof GrblController ? grbl.controller.getMachineInfo().bedHeight : 0;
  const machineBedFromGrbl = useMemo(() => {
    if (_bedWidth > 0 && _bedHeight > 0) return { width: _bedWidth, height: _bedHeight };
    return null;
  }, [_bedWidth, _bedHeight]);

  const machineAccelFromGrbl = useMemo(() => {
    const c = grbl.controller;
    if (!c || !(c instanceof GrblController)) return null;
    const { maxAccelX, maxAccelY } = c.getMachineInfo();
    if (maxAccelX > 0 && maxAccelY > 0) return Math.min(maxAccelX, maxAccelY);
    if (maxAccelX > 0) return maxAccelX;
    if (maxAccelY > 0) return maxAccelY;
    return null;
  }, [grbl.controller, grbl.machineState]);

  const grblMachineInfo = useMemo(() => {
    const c = grbl.controller;
    if (!c || !(c instanceof GrblController)) return null;
    const info = c.getMachineInfo();
    return info;
  }, [grbl.controller, grbl.machineState]);

  const activeProfile = useMemo(() => {
    void profileRevision;
    return getActiveProfile();
  }, [profileRevision]);
  const activeProfileId = useMemo(() => {
    void profileRevision;
    return getActiveProfileId();
  }, [profileRevision]);

  const resolvedMachineBedWidthMm = useMemo(
    () => resolveBedWidthMm(getActiveProfile(), machineBedFromGrbl),
    [profileRevision, machineBedFromGrbl],
  );
  const resolvedMachineBedHeightMm = useMemo(
    () => resolveBedHeightMm(getActiveProfile(), machineBedFromGrbl),
    [profileRevision, machineBedFromGrbl],
  );

  const allProfiles = useMemo(() => {
    void profileRevision;
    return getDeviceProfiles();
  }, [profileRevision]);
  const handleSceneCommitRef = useRef<((newScene: Scene) => void) | null>(null);

  const refreshProfiles = useCallback(() => setProfileRevision(v => v + 1), []);
  useEffect(() => {
    void Promise.all([
      initializeDeviceProfiles(),
      initializeMaterialLibrary(),
      initializeMaterialPresets(),
      entitlementService.initialize(),
    ])
      .then(() => {
        migrateDeviceProfileResponseCurves();
        refreshProfiles();
      })
      .catch(() => {
        migrateDeviceProfileResponseCurves();
        refreshProfiles();
      });
  }, [refreshProfiles]);
  useEffect(() => {
    const onExternalProfileChange = () => refreshProfiles();
    window.addEventListener('laserforge:active-profile-changed', onExternalProfileChange);
    return () => window.removeEventListener('laserforge:active-profile-changed', onExternalProfileChange);
  }, [refreshProfiles]);
  const updateActiveProfile = useCallback((updates: Partial<DeviceProfile>) => {
    const current = getActiveProfile();
    if (!current) return;
    const updated: DeviceProfile = { ...current, ...updates };
    saveDeviceProfile(updated);
    refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    const ctrl = grbl.controller;
    if (!ctrl || typeof ctrl.onWcsConsentNeeded !== 'function') return;

    return ctrl.onWcsConsentNeeded(async ({ g54, statusMask }) => {
      const profile = getActiveProfile();
      if (profile?.suppressWcsConsent === true) {
        ctrl.applyWcsNormalization?.();
        return;
      }

      const g54Line = `G54 offset: X=${g54.x.toFixed(3)} Y=${g54.y.toFixed(3)} Z=${g54.z.toFixed(3)}`;
      const maskLine = `$10 status mask: ${statusMask}`;

      const result = await showConfirmWithCheckbox(
        'Normalize machine settings?',
        'LaserForge requires G54 = (0,0,0) and $10 = 0 for reliable job placement.\n\n'
          + 'Your machine currently has:\n'
          + g54Line + '\n'
          + maskLine
          + '\n\n'
          + 'Normalize now? (Decline to leave settings unchanged — job placement is your responsibility.)',
        "Don't ask again for this profile",
      );

      if (result.checkboxChecked) {
        const p = getActiveProfile();
        if (p) {
          const updated: DeviceProfile = { ...p, suppressWcsConsent: true };
          saveDeviceProfile(updated);
          refreshProfiles();
        }
      }

      if (result.ok) {
        ctrl.applyWcsNormalization?.();
      } else {
        ctrl.skipWcsNormalization?.();
      }
    });
  }, [grbl.controller, showConfirmWithCheckbox, refreshProfiles]);

  useEffect(() => {
    const ctrl = grbl.controller;
    if (!ctrl || typeof ctrl.setStopOnError !== 'function') return;
    const profile = getActiveProfile();
    const value = profile?.stopOnError !== false;
    ctrl.setStopOnError(value);
  }, [grbl.controller, profileRevision]);

  const mergeProfilePreservedFields = useCallback((target: DeviceProfile, previous: DeviceProfile): void => {
    target.scanningOffsets = previous.scanningOffsets;
    target.maxAccelMmPerS2 = previous.maxAccelMmPerS2;
    target.accelAwarePower = previous.accelAwarePower;
    target.minPowerRatioAccel = previous.minPowerRatioAccel;
    target.smartOverscanEnabled = previous.smartOverscanEnabled;
    target.overscanMm = previous.overscanMm;
    target.preferredPort = previous.preferredPort;
    target.startGcode = previous.startGcode;
    target.endGcode = previous.endGcode;
    target.gcodeHeaderTemplate = previous.gcodeHeaderTemplate;
    target.gcodeFooterTemplate = previous.gcodeFooterTemplate;
    target.maxRateX = previous.maxRateX;
    target.maxRateY = previous.maxRateY;
    target.maxAccelX = previous.maxAccelX;
    target.maxAccelY = previous.maxAccelY;
    if (previous.suppressWcsConsent) target.suppressWcsConsent = true;
    if (previous.stopOnError === false) target.stopOnError = false;
  }, []);
  const setActiveProfileAndApply = useCallback((id: string | null) => {
    setActiveProfileId(id);
    refreshProfiles();
    if (!id) return;
    const profile = getDeviceProfiles().find(p => p.id === id);
    if (!profile) return;
    handleSceneCommitRef.current?.(applyProfileToScene(profile, scene));
  }, [refreshProfiles, scene]);
  const createProfileFromCurrentScene = useCallback((name: string) => {
    const profile = profileFromScene(name, scene);
    saveDeviceProfile(profile);
    setActiveProfileId(profile.id);
    refreshProfiles();
  }, [scene, refreshProfiles]);
  const updateCurrentProfileFromScene = useCallback(() => {
    const current = getActiveProfile();
    if (!current) return;
    const updated = profileFromScene(current.name, scene);
    updated.id = current.id;
    updated.createdAt = current.createdAt;
    updated.returnToOrigin = current.returnToOrigin ?? true;
    mergeProfilePreservedFields(updated, current);
    saveDeviceProfile(updated);
    refreshProfiles();
  }, [scene, mergeProfilePreservedFields, refreshProfiles]);
  const deleteProfileAndClearActive = useCallback((id: string) => {
    deleteDeviceProfile(id);
    if (getActiveProfileId() === id) setActiveProfileId(null);
    refreshProfiles();
  }, [refreshProfiles]);
  const handleAutoDetectMachine = useCallback(() => {
    if (!grblMachineInfo) return;
    const current = getActiveProfile();
    if (!current) return;
    updateActiveProfile({
      bedWidth: grblMachineInfo.bedWidth > 0 ? grblMachineInfo.bedWidth : current.bedWidth,
      bedHeight: grblMachineInfo.bedHeight > 0 ? grblMachineInfo.bedHeight : current.bedHeight,
      maxRateX: grblMachineInfo.maxFeedX > 0 ? grblMachineInfo.maxFeedX : current.maxRateX,
      maxRateY: grblMachineInfo.maxFeedY > 0 ? grblMachineInfo.maxFeedY : current.maxRateY,
      maxAccelX: grblMachineInfo.maxAccelX > 0 ? grblMachineInfo.maxAccelX : current.maxAccelX,
      maxAccelY: grblMachineInfo.maxAccelY > 0 ? grblMachineInfo.maxAccelY : current.maxAccelY,
      maxAccelMmPerS2:
        grblMachineInfo.maxAccelX > 0 && grblMachineInfo.maxAccelY > 0
          ? Math.min(grblMachineInfo.maxAccelX, grblMachineInfo.maxAccelY)
          : (grblMachineInfo.maxAccelX > 0 ? grblMachineInfo.maxAccelX
            : (grblMachineInfo.maxAccelY > 0 ? grblMachineInfo.maxAccelY : current.maxAccelMmPerS2)),
    });
  }, [grblMachineInfo, updateActiveProfile]);

  const {
    currentGcode,
    setCurrentGcode,
    compileGcode,
    compileToolpath,
    gcodeStale,
    setGcodeStale,
    sceneCompileTick,
    lastResult,
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

  useEffect(() => {
    if (grbl.isJobRunning && !wasJobRunningRef.current) {
      const ctx = machineUi.service.getActiveJobCanvasContext();
      if (ctx) {
        setActiveJobMoves(ctx.canvasMoves);
        setActiveJobPlanBounds(ctx.canvasPlanBounds);
        setActiveJobTransform(ctx.machineTransform);
      } else {
        console.warn(
          '[App] Job running but no active job canvas context — clearing active job canvas state',
        );
        setActiveJobMoves(null);
        setActiveJobPlanBounds(null);
        setActiveJobTransform(null);
      }
    } else if (!grbl.isJobRunning && wasJobRunningRef.current) {
      setActiveJobMoves(null);
      setActiveJobPlanBounds(null);
      setActiveJobTransform(null);
    }
    wasJobRunningRef.current = grbl.isJobRunning;
  }, [grbl.isJobRunning, machineUi.service]);

  const connectionSidebarWidth = connectionSidebarOpen
    ? Math.min(500, Math.floor(canvasSize.width * 0.45))
    : 0;
  const layersPanelWidth = connectionSidebarOpen ? 0 : 240;
  const toolbarWidth = 36;
  const canvasViewportWidth =
    canvasSize.width - toolbarWidth - connectionSidebarWidth - layersPanelWidth;

  const toolbarLaserConnected = useMemo(() => {
    const s = grbl.machineState;
    return !!s && s.status !== 'disconnected' && s.status !== 'connecting';
  }, [grbl.machineState]);

  useEffect(() => {
    if (grbl.machineState?.status === 'disconnected' && startModeRef.current === 'current') {
      setStartMode('absolute');
      try {
        localStorage.setItem('laserforge_start_mode', 'absolute');
      } catch { /* ignore */ }
    }
  }, [grbl.machineState?.status]);

  // Safety: clean stop on page unload — soft reset path + laser off; no disconnect (port dies with the page).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
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

      if (jobWasRunning) {
        e.preventDefault();
        e.returnValue = 'A laser job was running. The laser has been stopped. Are you sure you want to close?';
      }
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [machineUi.executionCoordinator]);

  const handleSaveOrigin = useCallback(() => {
    const pos = grbl.machineState?.position;
    if (!pos) return;
    const origin = { x: pos.x, y: pos.y };
    setSavedOrigin(origin);
    try {
      localStorage.setItem('laserforge_saved_origin', JSON.stringify(origin));
    } catch { /* ignore */ }
    void machineUi.executionCoordinator.setOriginAtCurrentPosition();
  }, [grbl.machineState, machineUi.executionCoordinator]);
  const sceneIsDirtyRef = useRef(false);
  const lastSavedSceneRef = useRef('');
  // T1-75 (origin) + T2-76 step 3 (extended on edits) + step 5
  // (extended via unified function): bridge counter for
  // ConnectionPanelMain so it can reset hasFramed (which is
  // encapsulated in the panel) when a scene mutation invalidates the
  // frame action's burn bounds. Bumped from commitSceneTransaction's
  // invalidate.frame() callback for any non-preview kind: edits
  // (since step 3), undo/redo (since step 5), and future
  // load/async-result paths.
  const [historyVersion, setHistoryVersion] = useState(0);
  const [productionMode, setProductionMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('laserforge_production_mode') === 'true';
    } catch {
      return false;
    }
  });
  const handleToggleProductionMode = useCallback(() => {
    if (productionMode) {
      setProductionMode(false);
      try {
        localStorage.setItem('laserforge_production_mode', 'false');
      } catch { /* ignore */ }
      return;
    }
    if (!isProUnlocked()) {
      if (confirm('PRO mode is a paid feature ($30 one-time).\n\nClick OK to learn more.')) {
        window.open('https://laserforge.pages.dev/landing.html', '_blank');
      }
      return;
    }
    setProductionMode(true);
    try {
      localStorage.setItem('laserforge_production_mode', 'true');
    } catch { /* ignore */ }
  }, [productionMode]);

  useEffect(() => {
    if (productionMode && !isProUnlocked()) {
      setProductionMode(false);
      try {
        localStorage.setItem('laserforge_production_mode', 'false');
      } catch { /* ignore */ }
    }
  }, [productionMode]);
  const [showRecover, setShowRecover] = useState(false);
  const [recoverAutosaveTimeLabel, setRecoverAutosaveTimeLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readAutosave().then(payload => {
      if (cancelled || !payload) return;
      try {
        const parsed = JSON.parse(payload.json) as { scene?: { objects?: unknown[] } };
        const objs = parsed.scene?.objects;
        if (Array.isArray(objs) && objs.length > 0) {
          setShowRecover(true);
          try {
            const d = new Date(payload.timestamp);
            setRecoverAutosaveTimeLabel(
              d.toLocaleDateString() + ' ' + d.toLocaleTimeString(),
            );
          } catch {
            setRecoverAutosaveTimeLabel(null);
          }
        }
      } catch { /* ignore */ }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [toastSuggestion, setToastSuggestion] = useState<{ suggestion: MaterialSuggestion; materialName: string } | null>(null);
  const [textPlacementHint, setTextPlacementHint] = useState<string | null>(null);
  const [textPlacementPt, setTextPlacementPt] = useState<{ x: number; y: number } | null>(null);
  const [textPreviewFontReady, setTextPreviewFontReady] = useState(true);
  const [lastCalibrationGridResult, setLastCalibrationGridResult] = useState<CalibrationGridResult | null>(null);
  const [, setPendingCalibration] = useState<{
    photoData: ImageData;
    result: CalibrationGridResult;
    roi: { x: number; y: number; width: number; height: number };
  } | null>(null);

  useEffect(() => {
    if (!textPlacementHint) return;
    const id = window.setTimeout(() => setTextPlacementHint(null), 5000);
    return () => clearTimeout(id);
  }, [textPlacementHint]);

  useEffect(() => {
    if (!dialogs.showTextDialog) return;
    if (typeof document === 'undefined' || !document.fonts?.load) {
      setTextPreviewFontReady(true);
      return;
    }

    let cancelled = false;
    const previewFontSizePx = Math.min(dialogs.textSize * 2, 48);
    const fontSpec =
      `${dialogs.textItalic ? 'italic ' : ''}` +
      `${dialogs.textBold ? 'bold ' : ''}` +
      `${previewFontSizePx}px "${dialogs.textFont}"`;
    const sample = dialogs.textInput || 'Preview';

    setTextPreviewFontReady(false);
    void document.fonts.load(fontSpec, sample)
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
  ]);

  const handleTextPlaced = useCallback(() => {
    setTextPlacementHint('Tip: Select text and click "Convert to Path" before cutting');
  }, []);

  const handleRequestTextPlacement = useCallback((world: { x: number; y: number }) => {
    dialogs.setEditingTextId(null);
    setTextPlacementPt({ x: world.x, y: world.y });
    dialogs.setShowTextDialog(true);
  }, [dialogs.setEditingTextId, dialogs.setShowTextDialog]);

  const handleEditText = useCallback((obj: SceneObject) => {
    dialogs.openTextEdit(obj);
    setTextPlacementPt(null);
    setSelectedIds(new Set([obj.id]));
  }, [dialogs.openTextEdit]);

  useEffect(() => {
    const onResize = () => setCanvasSize({ width: window.innerWidth, height: window.innerHeight - 34 });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Re-check setup after paint so Electron/localStorage is ready (avoids race with first launch).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        if (!localStorage.getItem(getSetupStorageKey())) {
          dialogs.setShowSetup(true);
        }
      } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, [dialogs.setShowSetup]);

  const historyRef = useRef<HistoryManager>(new HistoryManager());
  const isNudgingRef = useRef(false);
  const nudgeSceneRef = useRef<Scene | null>(null);
  const [historyAvail, setHistoryAvail] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    const h = historyRef.current;
    const sync = () => {
      setHistoryAvail({ canUndo: h.canUndo(), canRedo: h.canRedo() });
    };
    sync();
    return h.onChange(sync);
  }, []);

  // Push initial scene on mount
  useEffect(() => {
    // T2-78: tag the seed entry so it shows up in the history with a
    // meaningful label rather than the generic 'edit' default.
    historyRef.current.push(scene, { action: 'init' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // T2-76 step 2 of 8: wire the unified scene-mutation function. Step 2
  // only instantiates it against existing primitives; no caller is
  // migrated yet, so this binding is intentionally unreferenced until
  // step 3 starts routing handleSceneCommit through it.
  //
  // Captured-identity stability: React state setters
  // (setScene/setSelectedIds/setGcodeStale/setHistoryVersion) are stable
  // by React's contract. historyRef and sceneIsDirtyRef are refs -
  // captured by reference, dereferenced inside the lambdas (T2-76 design
  // risk 2 mitigation, see T2-76-design.md). setGcodeStale comes from
  // useCompileManager's return object so its identity is not guaranteed
  // stable across renders; including it in the dep array matches the
  // applyHistoryScene precedent below.
  //
  // notifyDirty: writes the boolean directly into sceneIsDirtyRef. T2-88
  // (hash-derived dirty) will swap this implementation for a no-op when
  // dirty becomes a derived value.
  //
  // invalidate.frame: bumps setHistoryVersion. The sole reader is
  // ConnectionPanelMain which resets hasFramed.current on bumps. Once
  // step 3 routes handleSceneCommit through this function, edits will
  // also reset hasFramed - semantically correct (frame action IS
  // invalidated by edits) and matches the existing scene-change useEffect
  // pattern. Comment update on the ConnectionPanelMain side is deferred
  // to step 3.
  //
  // invalidate.preflight: no-op. preflightRef does not exist in this
  // build; preflight recomputation is currently driven by a useEffect on
  // `scene`. T2-76 design risk 4 documents this; centralization is a
  // separate later cleanup.
  //
  // transitionLog: omitted. T3-68 will wire an emitter; until then the
  // function uses its optional-chain fallback.
  //
  // Note: this binding is unreferenced through step 2 by design (steps
  // 3-7 migrate callers). No active lint rule in this project flags
  // unused locals, so no disable directive is needed.
  const commitSceneTransaction: CommitSceneTransaction = useMemo(
    () => makeCommitSceneTransaction({
      setScene,
      history: {
        push: (s, m) => historyRef.current.push(s, m),
        reset: (s, m) => historyRef.current.reset(s, m),
      },
      setSelectedIds: (ids) => setSelectedIds(ids),
      notifyDirty: (dirty) => { sceneIsDirtyRef.current = dirty; },
      // T2-78: read-through-ref so SceneTransaction can record
      // selectionBefore on history entries without rebuilding this
      // useMemo every time the user clicks something. selectedIdsRef
      // is kept in sync with the selectedIds state by a useEffect at
      // declaration; this lambda always reads the freshest value.
      getSelection: () => selectedIdsRef.current,
      invalidate: {
        compile: () => setGcodeStale(true),
        frame: () => setHistoryVersion(v => v + 1),
        preflight: () => { /* no-op: see comment above */ },
      },
    }),
    [setGcodeStale],
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
    if (!dialogs.textInput.trim()) return;

    if (dialogs.editingTextId) {
      const newScene = {
        ...scene,
        objects: scene.objects.map(o =>
          o.id === dialogs.editingTextId
            ? {
                ...o,
                name: dialogs.textInput.length > 20 ? dialogs.textInput.slice(0, 20) + '...' : dialogs.textInput,
                geometry: {
                  ...(o.geometry as TextGeometry),
                  type: 'text' as const,
                  text: dialogs.textInput,
                  fontSize: dialogs.textSize,
                  fontFamily: dialogs.textFont,
                  bold: dialogs.textBold,
                  italic: dialogs.textItalic,
                },
                _bounds: null,
                _worldTransform: null,
              }
            : o
        ),
      };
      handleSceneCommit(newScene, 'text-edit');
    } else {
      const layerId = scene.activeLayerId || scene.layers[0]?.id;
      if (!layerId) return;

      const tx = textPlacementPt?.x ?? scene.canvas.width / 2 - 30;
      const ty = textPlacementPt?.y ?? scene.canvas.height / 2 - 10;

      const textObj: SceneObject = {
        id: generateId(),
        type: 'text',
        name: dialogs.textInput.length > 20 ? dialogs.textInput.slice(0, 20) + '...' : dialogs.textInput,
        layerId,
        parentId: null,
        transform: { ...IDENTITY_MATRIX, tx, ty },
        geometry: {
          type: 'text',
          text: dialogs.textInput,
          fontSize: dialogs.textSize,
          fontFamily: dialogs.textFont,
          bold: dialogs.textBold,
          italic: dialogs.textItalic,
        },
        visible: true,
        locked: false,
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      };

      const newScene = {
        ...scene,
        objects: [...scene.objects, textObj],
      };
      // T2-79+: atomic — selection of the new text object rides into
      // the history entry's selectionAfter. Undo restores pre-add
      // selection; redo restores the new text selected.
      handleSceneCommit(newScene, 'text-add', new Set([textObj.id]));
      handleTextPlaced();
    }

    dialogs.closeTextDialog();
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
    dialogs.editingTextId,
    dialogs.closeTextDialog,
    textPlacementPt,
    handleTextPlaced,
  ]);

  useEffect(() => {
    handleSceneCommitRef.current = handleSceneCommit;
  }, [handleSceneCommit]);

  const {
    handleConnectionRecompile,
    handleConnectionUpdateLayerMode,
    handleConnectionUpdateLayerSetting,
    handleConnectionUpdateLayerFillMode,
    handleConnectionUpdateLayerFillInterval,
    handleConnectionUpdateLayerFillBidirectional,
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

  const activeLayerMode = useMemo(() => {
    const layer = scene.layers.find(l => l.id === scene.activeLayerId);
    return layer?.settings.mode ?? scene.layers[0]?.settings.mode ?? 'cut';
  }, [scene.layers, scene.activeLayerId]);

  const interactableLayerIds = useMemo(() => {
    const activeLayer = scene.layers.find(l => l.id === scene.activeLayerId);
    const mode =
      activeLayer?.settings.mode ?? scene.layers[0]?.settings.mode ?? 'cut';
    return new Set(
      scene.layers.filter(l => l.settings.mode === mode).map(l => l.id),
    );
  }, [scene.layers, scene.activeLayerId]);

  const handleModeTabSelect = useCallback(
    (mode: string) => {
      const prev = sceneRef.current;
      const targetLayer = prev.layers.find(l => l.settings.mode === mode);

      if (targetLayer) {
        const next =
          prev.activeLayerId === targetLayer.id
            ? prev
            : { ...prev, activeLayerId: targetLayer.id };
        const modeLayerIds = new Set(
          next.layers.filter(l => l.settings.mode === mode).map(l => l.id),
        );
        const objectsOnMode = next.objects.filter(
          o => o.visible && modeLayerIds.has(o.layerId),
        );
        setSelectedIds(new Set(objectsOnMode.map(o => o.id)));
        if (prev.activeLayerId !== targetLayer.id) {
          setScene(next);
        }
        return;
      }

      const maxOrder =
        prev.layers.length > 0 ? Math.max(...prev.layers.map(l => l.order)) : -1;
      const modeNames: Record<string, string> = {
        cut: 'Cut',
        engrave: 'Engrave',
        score: 'Score',
        image: 'Image',
      };
      const newLayer = createLayer(
        maxOrder + 1,
        mode as LayerMode,
        modeNames[mode] ?? mode,
      );
      const next: Scene = {
        ...prev,
        layers: [...prev.layers, newLayer],
        activeLayerId: newLayer.id,
      };
      const modeLayerIds = new Set(
        next.layers.filter(l => l.settings.mode === mode).map(l => l.id),
      );
      const objectsOnMode = next.objects.filter(
        o => o.visible && modeLayerIds.has(o.layerId),
      );
      const modeSelection = new Set(objectsOnMode.map(o => o.id));
      // T2-79+: atomic — selecting all objects on the new mode-layer
      // rides into the history entry's selectionAfter. Undo restores
      // the pre-mode-select selection; redo re-selects the matched
      // objects.
      handleSceneCommit(next, 'mode-select', modeSelection);
    },
    [handleSceneCommit],
  );

  const handleActivateLayer = useCallback((layerId: string) => {
    const prev = sceneRef.current;
    if (prev.activeLayerId === layerId) return;
    // View-state change, no history entry — use handleSceneChange, not handleSceneCommit.
  handleSceneChange({ ...prev, activeLayerId: layerId });
}, [handleSceneChange]);

  const handleSelectStartMode = useCallback((mode: StartMode, origin: { x: number; y: number }) => {
    setStartMode(mode);
    try {
      localStorage.setItem('laserforge_start_mode', mode);
    } catch { /* ignore */ }
    handleSceneCommit({
      ...scene,
      startPosition: { x: Math.round(origin.x), y: Math.round(origin.y) },
    }, 'start-position');
  }, [scene, handleSceneCommit]);

  const handleExit = useCallback(async () => {
    const ctrl = grbl.controllerRef.current;
    const status = grbl.machineState?.status;
    const isConnected = !!status && status !== 'disconnected' && status !== 'connecting';

    if (isConnected && ctrl) {
      if (ctrl.isJobRunning) {
        const ok = confirm(
          'A laser job is running!\n\nThe laser will be stopped. Are you sure you want to exit?',
        );
        if (!ok) return;
      }
      await machineUi.executionCoordinator.safeDisconnect();
    }

    if (sceneIsDirtyRef.current) {
      const confirmed = confirm('You have unsaved changes. Are you sure you want to exit?');
      if (!confirmed) return;
    }

    if (window.electronAPI?.quit) {
      void window.electronAPI.quit();
      return;
    }

    window.location.href = '/landing.html';
  }, [grbl.machineState?.status, machineUi.executionCoordinator]);

  const handleCameraPositionDesign = useCallback((worldX: number, worldY: number) => {
    if (selectedIds.size === 0) {
      let minX = Infinity;
      let minY = Infinity;
      for (const obj of scene.objects) {
        if (!obj.visible) continue;
        minX = Math.min(minX, obj.transform.tx);
        minY = Math.min(minY, obj.transform.ty);
      }
      if (!Number.isFinite(minX)) return;
      const dx = worldX - minX;
      const dy = worldY - minY;
      const newScene: Scene = {
        ...scene,
        objects: scene.objects.map(o => ({
          ...o,
          transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy },
        })),
      };
      handleSceneCommit(newScene, 'camera-position');
      return;
    }

    const selected = scene.objects.filter(o => selectedIds.has(o.id));
    let minX = Infinity;
    let minY = Infinity;
    for (const o of selected) {
      minX = Math.min(minX, o.transform.tx);
      minY = Math.min(minY, o.transform.ty);
    }
    const dx = worldX - minX;
    const dy = worldY - minY;
    const newScene: Scene = {
      ...scene,
      objects: scene.objects.map(o =>
        selectedIds.has(o.id)
          ? { ...o, transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy } }
          : o
      ),
    };
    handleSceneCommit(newScene, 'camera-position');
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
      commitSceneTransaction(newScene, { kind: 'load', source }, {
        selectionAfter: new Set(),
      });
    },
    [commitSceneTransaction],
  );

  const handleTogglePreview = useCallback(() => {
    setShowToolpathPreview(p => !p);
  }, []);

  // Clear preview state only when preview mode is actually off or suppressed by a job.
  useEffect(() => {
    if (!showToolpathPreview || grbl.isJobRunning) {
      setToolpathPreviewMoves(null);
    }
  }, [showToolpathPreview, grbl.isJobRunning]);

  // Toolpath overlay follows the same `scene` as the canvas (fingerprint includes geometry, layers, transforms).
  useEffect(() => {
    // Never recompile during a running job — main-thread stalls starve the
    // WiFi bridge and cause GRBL's planner buffer to drain, silently stopping
    // the machine mid-job. The auto-recompile effect has this same guard.
    if (grbl.isJobRunning || !showToolpathPreview) return;

    let cancelled = false;
    void compileToolpath(scene).then(m => {
      if (cancelled) return;
      if (m === null) {
        void showAlert('No Objects', 'No objects to preview. Add objects to an output layer first.');
        setShowToolpathPreview(false);
        setToolpathPreviewMoves(null);
        return;
      }
      setToolpathPreviewMoves(m);
    });
    return () => { cancelled = true; };
  }, [showToolpathPreview, sceneCompileTick, compileToolpath, showAlert, grbl.isJobRunning]);

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
    setShowRecover,
    setRecoverAutosaveTimeLabel,
    viewportActionsRef,
    refreshProfiles,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      if (!sceneIsDirtyRef.current) return;

      let json: string;
      try {
        json = serializeForAutosave(scene);
      } catch (e) {
        console.warn('[LaserForge] Autosave failed (serialize):', e);
        // Leave sceneIsDirtyRef.current = true so the next tick retries.
        return;
      }

      if (json === lastSavedSceneRef.current) {
        sceneIsDirtyRef.current = false;
        return;
      }

      // Only clear the dirty flag and advance lastSavedSceneRef AFTER the
      // underlying storage write resolves. A failed write (quota, fs error,
      // IPC failure) must leave the project marked dirty so the next tick
      // retries — otherwise unsaved data is silently lost.
      void writeAutosaveAsync(json).then(
        () => {
          lastSavedSceneRef.current = json;
          sceneIsDirtyRef.current = false;
        },
        (err: unknown) => {
          console.warn('[LaserForge] Autosave failed:', err);
          // Intentionally do NOT clear sceneIsDirtyRef and do NOT advance
          // lastSavedSceneRef — the project remains dirty for retry.
        },
      );
    }, 30000);

    return () => clearInterval(interval);
  }, [scene]);

  const activeLayerModeForSuggestion = scene.layers.find(l => l.id === scene.activeLayerId)?.settings.mode;
  useEffect(() => {
    const materialName = scene.material?.name;
    const machineType = scene.machine?.type || 'diode';
    const activeLayer = scene.layers.find(l => l.id === scene.activeLayerId);

    if (!materialName || !activeLayer) {
      setToastSuggestion(null);
      return;
    }

    let cancelled = false;
    void getSuggestion(materialName, machineType, activeLayer.settings.mode).then(suggestion => {
      if (cancelled) return;
      if (suggestion && suggestion.sampleCount > 0) {
        setToastSuggestion({ suggestion, materialName });
      } else {
        setToastSuggestion(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scene.material?.name, scene.machine?.type, scene.activeLayerId, activeLayerModeForSuggestion]);

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
  // Currently only consumed by the (no-op) transitionLog optional
  // chain; T3-68 will wire a real emitter and the tag will become
  // visible in the log.
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

  const handleUndo = useCallback(() => {
    const entry = historyRef.current.undoEntry();
    if (!entry) return;
    const validSelection = filterValidIds(entry.selectionAfter, entry.scene);
    applyHistoryScene(entry.scene, 'undo', validSelection);
  }, [applyHistoryScene]);

  const handleRedo = useCallback(() => {
    const entry = historyRef.current.redoEntry();
    if (!entry) return;
    const validSelection = filterValidIds(entry.selectionAfter, entry.scene);
    applyHistoryScene(entry.scene, 'redo', validSelection);
  }, [applyHistoryScene]);

  const handleSelectAll = useCallback(() => {
    const allIds = new Set(scene.objects.filter(o => o.visible && !o.locked).map(o => o.id));
    setSelectedIds(allIds);
  }, [scene]);

  const handleDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const newScene = deleteObjects(scene, selectedIds);
    // T1-73 (origin) + T2-76 step 4 (extension): route through the
    // unified mutation function with the 'delete' action label and an
    // explicit empty selection. selectionAfter is applied inside
    // commitSceneTransaction so the selection-clear is part of the
    // same transaction as the scene replacement (matches the
    // function's documented contract; see SceneTransaction.ts step 5
    // of dispatch). T1-73's original concern (autosave skipping the
    // deletion if the project stayed clean) is still satisfied:
    // commitSceneTransaction calls notifyDirty(true) for kind='edit'.
    commitSceneTransaction(newScene, { kind: 'edit', action: 'delete' }, {
      selectionAfter: new Set(),
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
    sceneIsDirtyRef,
    lastSavedSceneRef,
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
    try {
      const gc = await compileGcode(scene);
      if (!gc) {
        await showAlert('No Objects', 'No objects to process. Add objects to an output layer first.');
      }
      setCurrentGcode(gc);
    } catch (err) {
      console.error('G-code build failed:', err);
      setCurrentGcode(null);
    }
    dialogs.setShowConnection(true);
  }, [scene, compileGcode, showAlert, dialogs]);

  const handleToolbarDisconnect = useCallback(async () => {
    try {
      await machineUi.executionCoordinator.safeDisconnect({ skipStop: true });
    } catch { /* best effort */ }
    dialogs.setShowConnection(false);
  }, [machineUi.executionCoordinator, dialogs]);

  const handleGridArray = useCallback(() => {
    if (selectedIds.size === 0) return;

    // Compute bounds of selection
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of scene.objects) {
      if (!selectedIds.has(obj.id)) continue;
      const b = computeObjectBounds(obj);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }

    setGridArrayBounds({ w: maxX - minX, h: maxY - minY });
    setShowGridArray(true);
  }, [scene, selectedIds]);

  const {
    handleGridArrayConfirm,
    handleNestingApply,
    handleBoxGenerate,
    handleVariableTextGenerate,
    handleTemplateSelect,
  } = useGeneratorHandlers({
    scene,
    selectedIds,
    setSelectedIds,
    handleSceneCommit,
    setShowGridArray,
    setShowTemplates: dialogs.setShowTemplates,
    showAlert,
  });

  const { handleMaterialTestApply } = useMaterialTestHandlers({
    scene,
    handleSceneCommit,
  });

  const handleCalibrationGridEmitted = useCallback((result: CalibrationGridResult) => {
    const nextScene: Scene = {
      ...scene,
      layers: [...scene.layers, ...result.layers],
      objects: [...scene.objects, ...result.objects],
      activeLayerId: result.layers[0]?.id ?? scene.activeLayerId,
    };
    setLastCalibrationGridResult(result);
    handleSceneCommit(nextScene, 'calibration-grid');
  }, [scene, handleSceneCommit]);

  const handleCalibrationCurveReady = useCallback((
    curve: ResponseCurve,
    _measurements: Array<{ index: number; commandedPower: number; meanLuminance: number; observedDarkness: number }>,
  ) => {
    // Preferred path: bind the curve to a matching MaterialPreset so it
    // follows the material (and any layers linked via materialPresetId)
    // across jobs and device profiles.
    const matching = getPresets().find(
      p => p.material.toLowerCase() === curve.materialName.toLowerCase(),
    );
    if (matching) {
      const updatedPreset: MaterialPreset = { ...matching, responseCurve: curve };
      savePreset(updatedPreset);
      setPendingCalibration(null);
      return;
    }

    // Fallback: no matching preset — keep writing to the device profile so
    // the legacy JobCompiler read path still finds the curve.
    const profile = getActiveProfile();
    if (!profile) return;
    const updated: DeviceProfile = {
      ...profile,
      responseCurves: {
        ...(profile.responseCurves ?? {}),
        [curve.materialName]: curve,
      },
    };
    saveDeviceProfile(updated);
    refreshProfiles();
    setPendingCalibration(null);
  }, [refreshProfiles]);

  const {
    handleKerfGenerateTest,
    handleKerfApply,
    handleKerfSaveToPreset,
  } = useKerfHandlers({
    scene,
    handleSceneCommit,
    showAlert,
  });

  const {
    handleMaterialConfirm,
    handleMaterialClear,
    handleMaterialPresetApply,
  } = useMaterialHandlers({
    scene,
    handleSceneCommit,
    setShowMaterial: dialogs.setShowMaterial,
  });

  const handleNudge = useCallback((dx: number, dy: number, commit: boolean) => {
    if (commit) {
      if (isNudgingRef.current && nudgeSceneRef.current) {
        handleSceneCommit(nudgeSceneRef.current, 'nudge');
        isNudgingRef.current = false;
        nudgeSceneRef.current = null;
      }
      return;
    }
    if (selectedIds.size === 0) return;
    const baseScene = nudgeSceneRef.current || scene;
    const newScene = {
      ...baseScene,
      objects: baseScene.objects.map(o =>
        selectedIds.has(o.id)
          ? { ...o, transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy } }
          : o
      ),
    };
    handleSceneChange(newScene);
    nudgeSceneRef.current = newScene;
    isNudgingRef.current = true;
  }, [scene, selectedIds, handleSceneChange, handleSceneCommit]);

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
        onToggleShortcuts: () => dialogs.setShowShortcuts(s => !s),
        onNudge: handleNudge,
        selectionCount: selectedIds.size,
        clipboardItemCount: clipboard.length,
        onBooleanUnion: () => void sceneOps.performBoolean('union'),
        onBooleanSubtract: () => void sceneOps.performBoolean('subtract'),
        onBooleanIntersect: () => void sceneOps.performBoolean('intersect'),
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
        sceneOps.performBoolean,
        sceneOps.centerOnMaterial,
        handleGridArray,
        handleTogglePreview,
        scene,
        selectedIds,
        clipboard,
        handleSceneCommit,
        dialogs.setShowShortcuts,
      ],
    ),
  );

  const hasSelectedText = scene.objects.some(o =>
    selectedIds.has(o.id) && o.geometry.type === 'text'
  );

  // ─── RENDER ──────────────────────────────────────────────────

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
    isDragOver && React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        background: 'rgba(59, 139, 235, 0.15)',
        border: '3px dashed #3b8beb',
        borderRadius: 8,
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      },
    },
      React.createElement('div', {
        style: { color: '#3b8beb', fontSize: 20, fontFamily: 'monospace' },
      }, 'Drop file to import (SVG, DXF, PNG, JPG, JSON)'),
    ),

    React.createElement(FileToolbar, {
      scene,
      compileGcode,
      onSceneChange: handleSceneChange,
      onSceneCommit: handleSceneCommit,
      onNewProject: handleNewProject,
      onAfterSuccessfulFileSave: syncAutosaveAfterFileSave,
      showAlert,
      showConfirm,
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
      onPreviewToggle: () => setPreviewMode(p => !p),
      previewMode,
      onUndo: handleUndo,
      onRedo: handleRedo,
      canUndo: historyAvail.canUndo,
      canRedo: historyAvail.canRedo,
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
        setSettingsInitialTab(tab ?? 'machine');
        setSettingsOpen(true);
      },
    }),

    showRecover && !dialogs.showSetup && React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 12, padding: '6px 16px',
        background: 'rgba(0, 212, 255, 0.06)',
        borderBottom: '1px solid rgba(0, 212, 255, 0.15)',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 11,
      },
    },
      React.createElement('span', { style: { color: '#8888aa' } },
        `Unsaved work found from ${recoverAutosaveTimeLabel ?? 'previous session'}`,
      ),
      React.createElement('button', {
        onClick: handleRecover,
        style: {
          padding: '3px 12px', background: 'rgba(0, 212, 255, 0.1)',
          border: '1px solid #00d4ff', borderRadius: 4,
          color: '#00d4ff', fontSize: 10, cursor: 'pointer',
          fontFamily: "'DM Sans', system-ui, sans-serif", fontWeight: 500,
        },
      }, 'Recover'),
      React.createElement('button', {
        onClick: () => {
          setShowRecover(false);
          setRecoverAutosaveTimeLabel(null);
          clearAutosave();
        },
        style: {
          padding: '3px 12px', background: 'transparent',
          border: '1px solid #252540', borderRadius: 4,
          color: '#555570', fontSize: 10, cursor: 'pointer',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        },
      }, 'Dismiss'),
    ),

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
          startMode === 'absolute'
            ? 'Canvas = Bed position'
            : startMode === 'current'
              ? 'Design starts at laser head'
              : savedOrigin
                ? `Design starts at saved origin X:${savedOrigin.x.toFixed(0)} Y:${savedOrigin.y.toFixed(0)}`
                : 'No saved origin - set one below',
          ),
          React.createElement(CanvasViewport, {
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
        }),
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
      connectionSidebarOpen && React.createElement(ConnectionPanel, {
        controller: grbl.controller!,
        portRef: grbl.portRef,
        machineState: grbl.machineState,
        jobProgress: grbl.jobProgress,
        scene,
        sidebarWidth: connectionSidebarWidth,
        productionMode,
        gcode: currentGcode,
        compiledJobTicket: lastResult?.ticket ?? null,
        lastGcodeCompileResult: lastResult,
        onClose: () => dialogs.setShowConnection(false),
        onDisconnect: () => dialogs.setShowConnection(false),
      onOpenSettings: (tab?: SettingsTab) => {
        setSettingsInitialTab(tab ?? 'machine');
        setSettingsOpen(true);
      },
        bedWidth: resolvedMachineBedWidthMm,
        bedHeight: resolvedMachineBedHeightMm,
        machinePlanBounds: activeJobTransform?.plan.bounds ?? null,
        boundsMinX: Number.isFinite(sceneBounds.minX) ? sceneBounds.minX : 0,
        boundsMinY: Number.isFinite(sceneBounds.minY) ? sceneBounds.minY : 0,
        boundsMaxX: Number.isFinite(sceneBounds.maxX) ? sceneBounds.maxX : 100,
        boundsMaxY: Number.isFinite(sceneBounds.maxY) ? sceneBounds.maxY : 100,
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
        historyVersion,
        onRecompile: handleConnectionRecompile,
        onUpdateLayerMode: handleConnectionUpdateLayerMode,
        onUpdateLayerFillMode: handleConnectionUpdateLayerFillMode,
        onUpdateLayerFillInterval: handleConnectionUpdateLayerFillInterval,
        onUpdateLayerFillBidirectional: handleConnectionUpdateLayerFillBidirectional,
        onUpdateLayerSetting: handleConnectionUpdateLayerSetting,
        machineUi,
      }),
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
      onMaterialApplied: () => setMaterialLibraryRev(r => r + 1),
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
    }),

    dialogs.showSetup && React.createElement(WelcomeWizard, {
      onComplete: handleWizardComplete,
      onSkip: handleWizardSkip,
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
      initialHomingEnabled: activeProfile?.homingEnabled,
      initialMaxSpindle: activeProfile?.maxSpindle,
    }),

    dialogs.showShortcuts && React.createElement(ShortcutsPanel, {
      onClose: () => dialogs.setShowShortcuts(false),
    }),

    React.createElement(SettingsModal, {
      open: settingsOpen,
      onClose: () => setSettingsOpen(false),
      initialTab: settingsInitialTab,
      machineTab: React.createElement(MachineSettingsTab, {
        activeProfile,
        onUpdateProfile: updateActiveProfile,
        canAutoDetect: !!grblMachineInfo,
        onAutoDetect: handleAutoDetectMachine,
        autoDetecting: false,
        onReRunSetup: () => {
          setSettingsOpen(false);
          dialogs.setShowSetup(true);
        },
      }),
      gcodeTab: React.createElement(GcodeSettingsTab, {
        activeProfile,
        onUpdateProfile: updateActiveProfile,
      }),
      calibrationTab: React.createElement(CalibrationSettingsTab, {
        activeProfile,
        onUpdateProfile: updateActiveProfile,
      }),
      profilesTab: React.createElement(ProfilesSettingsTab, {
        profiles: allProfiles,
        activeProfileId,
        onSetActiveProfile: setActiveProfileAndApply,
        onCreateProfileFromCurrentScene: createProfileFromCurrentScene,
        onUpdateCurrentFromScene: updateCurrentProfileFromScene,
        onDeleteProfile: deleteProfileAndClearActive,
      }),
      aboutTab: React.createElement('div', null,
        React.createElement('h3', { style: { marginTop: 0 } }, 'LaserForge'),
        React.createElement('p', { style: { fontSize: 12, color: '#c0c0d0', lineHeight: 1.6 } },
          `Version: v0.1.0`, React.createElement('br'),
          `License: ${tierDisplayName(entitlementService.getState().tier)}`,
        ),
        React.createElement('p', { style: { fontSize: 11, color: '#888', marginTop: 20 } },
          'Third-party licenses: see LICENSES-THIRD-PARTY.md'),
        React.createElement('p', { style: { marginTop: 12 } },
          React.createElement('button', {
            type: 'button',
            onClick: () => setShowFontCredits(true),
            style: {
              background: 'rgba(0,212,255,0.08)',
              border: '1px solid rgba(0,212,255,0.25)',
              borderRadius: 6,
              padding: '8px 14px',
              fontSize: 12,
              color: '#00d4ff',
              cursor: 'pointer',
              fontFamily: "'DM Sans', system-ui, sans-serif",
            },
          }, 'Font credits (bundled fonts)')),
      ),
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

    React.createElement(AddTextDialog, {
      showTextDialog: dialogs.showTextDialog,
      editingTextId: dialogs.editingTextId,
      textInput: dialogs.textInput,
      textFont: dialogs.textFont,
      textSize: dialogs.textSize,
      textBold: dialogs.textBold,
      textItalic: dialogs.textItalic,
      textPreviewFontReady,
      setTextInput: dialogs.setTextInput,
      setTextFont: dialogs.setTextFont,
      setTextSize: dialogs.setTextSize,
      setTextBold: dialogs.setTextBold,
      setTextItalic: dialogs.setTextItalic,
      onClose: () => {
        dialogs.closeTextDialog();
        setTextPlacementPt(null);
      },
      onSubmit: handleAddTextDialogSubmit,
      onShowFontCredits: () => setShowFontCredits(true),
    }),

    showFontCredits && React.createElement(FontCreditsDialog, {
      onClose: () => setShowFontCredits(false),
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
