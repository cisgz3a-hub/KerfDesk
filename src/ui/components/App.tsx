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
import { sendSetOriginWcsCommand } from '../origin/sendSetOriginWcsCommand';
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
import { getPresets, savePreset, migrateDeviceProfileResponseCurves } from '../../core/materials/MaterialLibrary';
import type { MaterialPreset } from '../../core/materials/MaterialPreset';
import { BUNDLED_FONTS } from '../../fonts/fontRegistry';
import { injectBundledFontFaces } from '../../fonts/injectFontFaces';
import { SettingsModal, type SettingsTab } from './SettingsModal';
import {
  deleteDeviceProfile,
  getActiveProfile,
  getActiveProfileId,
  getDeviceProfiles,
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

  // One-time migration: move D.13 response curves stored on DeviceProfile
  // onto matching MaterialPresets. Idempotent and cheap — safe on every mount.
  useEffect(() => {
    migrateDeviceProfileResponseCurves();
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
    compileToResult,
    gcodeStale,
    setGcodeStale,
    sceneCompileTick,
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
    let cancelled = false;

    if (grbl.isJobRunning && !wasJobRunningRef.current) {
      void (async () => {
        try {
          const result = await compileToResult(scene);
          if (cancelled) return;
          if (!result) {
            setActiveJobMoves(null);
            setActiveJobPlanBounds(null);
            setActiveJobTransform(null);
          } else {
            setActiveJobMoves(result.canvasMoves);
            setActiveJobPlanBounds(result.canvasPlanBounds);
            setActiveJobTransform(result.machineTransform);
          }
        } catch {
          if (!cancelled) {
            setActiveJobMoves(null);
            setActiveJobPlanBounds(null);
            setActiveJobTransform(null);
          }
        }
      })();
    } else if (!grbl.isJobRunning && wasJobRunningRef.current) {
      setActiveJobMoves(null);
      setActiveJobPlanBounds(null);
      setActiveJobTransform(null);
    }
    wasJobRunningRef.current = grbl.isJobRunning;

    return () => {
      cancelled = true;
    };
  }, [grbl.isJobRunning, scene, compileToResult]);

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

  // Safety: clean stop on page unload — feed hold + laser off, not soft reset (avoids ALARM:3 / forced rehome).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const ctrl = grbl.controllerRef.current;
      if (!ctrl) return;
      const status = ctrl.state.status;
      if (status === 'disconnected' || status === 'connecting') return;

      const jobWasRunning = ctrl.isJobRunning;
      try {
        ctrl.stop();
        ctrl.sendCommand('M5 S0');
      } catch {
        /* port may already be gone */
      }

      if (jobWasRunning) {
        e.preventDefault();
        e.returnValue = 'A laser job was running. The laser has been stopped. Are you sure you want to close?';
      }
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handleSaveOrigin = useCallback(() => {
    const pos = grbl.machineState?.position;
    if (!pos) return;
    const origin = { x: pos.x, y: pos.y };
    setSavedOrigin(origin);
    try {
      localStorage.setItem('laserforge_saved_origin', JSON.stringify(origin));
    } catch { /* ignore */ }
    sendSetOriginWcsCommand(grbl.controller);
  }, [grbl.machineState, grbl.controller]);
  const sceneIsDirtyRef = useRef(false);
  const lastSavedSceneRef = useRef('');
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
  const [showRecover, setShowRecover] = useState(() => {
    try {
      const saved = localStorage.getItem('laserforge_autosave');
      const time = localStorage.getItem('laserforge_autosave_time');
      if (saved && time) {
        const parsed = JSON.parse(saved) as { scene?: { objects?: unknown[] } };
        const objs = parsed.scene?.objects;
        if (Array.isArray(objs) && objs.length > 0) return true;
      }
    } catch { /* ignore */ }
    return false;
  });
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
    historyRef.current.push(scene);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── SCENE HANDLERS ──────────────────────────────────────────

  /** Preview: update UI without creating a history entry. */
  const handleSceneChange = useCallback((newScene: Scene) => {
    setScene(newScene);
  }, []);

  /** Commit: update UI AND create a history entry. */
  const handleSceneCommit = useCallback((newScene: Scene) => {
    sceneIsDirtyRef.current = true;
    historyRef.current.push(newScene);
    setScene(newScene);
  }, []);

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
      handleSceneCommit(newScene);
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
      handleSceneCommit(newScene);
      setSelectedIds(new Set([textObj.id]));
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
      setSelectedIds(new Set(objectsOnMode.map(o => o.id)));
      handleSceneCommit(next);
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
    });
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
      try {
        // Clean stop (feed hold + queued laser off) — not soft reset, to avoid ALARM:3 / forced rehome.
        ctrl.stop();
      } catch {
        /* ignore */
      }
      try {
        ctrl.sendCommand('M5 S0');
      } catch {
        /* ignore */
      }
      await ctrl.disconnect();
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
  }, [grbl.machineState?.status]);

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
      handleSceneCommit(newScene);
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
    handleSceneCommit(newScene);
  }, [scene, selectedIds, handleSceneCommit]);

  const sceneOps = useSceneOperations({
    scene,
    selectedIds,
    handleSceneCommit,
    setSelectedIds: (ids) => setSelectedIds(ids),
    showAlert,
    showConfirm,
  });

  /** New project: reset history entirely and start fresh. */
  const handleNewProject = useCallback((newScene: Scene) => {
    sceneIsDirtyRef.current = false;
    setSelectedIds(new Set());
    historyRef.current.reset(newScene);
    setScene(newScene);
  }, []);

  const handleTogglePreview = useCallback(() => {
    setShowToolpathPreview(p => !p);
  }, []);

  // Toolpath overlay follows the same `scene` as the canvas (fingerprint includes geometry, layers, transforms).
  useEffect(() => {
    // Never recompile during a running job — main-thread stalls starve the
    // WiFi bridge and cause GRBL's planner buffer to drain, silently stopping
    // the machine mid-job. The auto-recompile effect has this same guard.
    if (grbl.isJobRunning) return;

    if (!showToolpathPreview) {
      setToolpathPreviewMoves(null);
      return;
    }
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
    (ids) => setSelectedIds(ids),
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
    viewportActionsRef,
    refreshProfiles,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      if (!sceneIsDirtyRef.current) return;

      try {
        const json = serializeForAutosave(scene);

        if (json === lastSavedSceneRef.current) {
          sceneIsDirtyRef.current = false;
          return;
        }

        localStorage.setItem('laserforge_autosave', json);
        localStorage.setItem('laserforge_autosave_time', new Date().toISOString());
        lastSavedSceneRef.current = json;
        sceneIsDirtyRef.current = false;
      } catch (e) {
        console.warn('[LaserForge] Autosave failed:', e);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [scene]);

  useEffect(() => {
    const materialName = scene.material?.name;
    const machineType = scene.machine?.type || 'diode';
    const activeLayer = scene.layers.find(l => l.id === scene.activeLayerId);

    if (!materialName || !activeLayer) {
      setToastSuggestion(null);
      return;
    }

    const suggestion = getSuggestion(materialName, machineType, activeLayer.settings.mode);

    if (suggestion && suggestion.sampleCount > 0) {
      setToastSuggestion({ suggestion, materialName });
    } else {
      setToastSuggestion(null);
    }
  }, [scene.material?.name, scene.activeLayerId]); // eslint-disable-line react-hooks/exhaustive-deps -- material/layer identity only

  // ─── UNDO / REDO ─────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    const prev = historyRef.current.undo();
    if (prev) { setScene(prev); setSelectedIds(new Set()); }
  }, []);

  const handleRedo = useCallback(() => {
    const next = historyRef.current.redo();
    if (next) { setScene(next); setSelectedIds(new Set()); }
  }, []);

  const handleSelectAll = useCallback(() => {
    const allIds = new Set(scene.objects.filter(o => o.visible && !o.locked).map(o => o.id));
    setSelectedIds(allIds);
  }, [scene]);

  const handleDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const newScene = deleteObjects(scene, selectedIds);
    historyRef.current.push(newScene);
    setScene(newScene);
    setSelectedIds(new Set());
  }, [scene, selectedIds]);

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
      try { grbl.controller?.sendCommand('M5 S0'); } catch { /* ignore */ }
      await grbl.disconnect();
    } catch { /* best effort */ }
    dialogs.setShowConnection(false);
  }, [grbl, dialogs]);

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
    handleSceneCommit(nextScene);
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
        handleSceneCommit(nudgeSceneRef.current);
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
        if (gatedFeature('box_generator')) {
          dialogs.setShowBoxGenerator(true);
        }
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
        `Unsaved work found from ${(() => {
          try {
            const t = localStorage.getItem('laserforge_autosave_time');
            if (t) {
              const d = new Date(t);
              return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
            }
          } catch { /* ignore */ }
          return 'previous session';
        })()}`,
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
          try { localStorage.removeItem('laserforge_autosave'); } catch { /* ignore */ }
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
          onClearMaterial: () => handleSceneCommit({ ...scene, material: null }),
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
        handleSceneCommit({ ...scene, layers: newLayers });
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
