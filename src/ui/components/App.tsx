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
import { type MachineTransformResult } from '../../core/plan/MachineTransform';
import { type Move } from '../../core/plan/Plan';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDialogs } from '../hooks/useDialogs';
import { useSceneOperations } from '../hooks/useSceneOperations';
import { useControllerConnection } from '../hooks/useControllerConnection';
import { GrblController } from '../../controllers/grbl/GrblController';
import { CanvasViewport, type ViewportActions } from './CanvasViewport';
import { ModeTabsOverlay } from './canvas/ModeTabsOverlay';
import { LayerPanel } from './LayerPanel';
import { ToolBar, type ToolType } from './ToolBar';
import { ContextMenu } from './ContextMenu';
import { GridArrayDialog, type GridArrayConfig } from './GridArrayDialog';
import { MaterialTestDialog } from './MaterialTestDialog';
import { GcodePreview } from './GcodePreview';
import { MaterialDialog, type MaterialConfig } from './MaterialDialog';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { deserializeScene, serializeForAutosave, serializeScene } from '../../io/SceneSerializer';
import { saveSceneToFile } from '../../io/FileIO';
import { generateId, IDENTITY_MATRIX, MAX_LASER_SPEED, MIN_LASER_SPEED } from '../../core/types';
import { createLayer, type Layer, type LayerMode, type FillMode } from '../../core/scene/Layer';
import { applyLayerModeChange } from '../../core/scene/layerModeTransition';
import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { offsetObject } from '../../geometry/OffsetPath';
import { theme } from '../styles/theme';
import { WelcomeWizard, type WizardResult } from './WelcomeWizard';
import { ShortcutsPanel } from './ShortcutsPanel';
import { ConnectionPanel } from './ConnectionPanel';
import { TemplateBrowser } from './TemplateBrowser';
import { BoxGenerator } from './BoxGenerator';
import { NestingDialog } from './NestingDialog';
import { MaterialLibraryDialog } from './MaterialLibraryDialog';
import { CameraDialog } from './CameraDialog';
import { KerfWizard } from './KerfWizard';
import { VariableTextDialog } from './VariableTextDialog';
import { NumberInput } from './NumberInput';
import { LearnedToast } from './LearnedToast';
import { getSuggestion, type MaterialSuggestion } from '../../core/materials/MaterialFeedback';
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

type StartMode = GcodeStartMode;
import {
  MATERIAL_CATEGORIES,
  MATERIAL_PRESETS,
  getPresetSettings,
  getAllMaterials,
  getUserMaterials,
} from '../../core/materials/MaterialPresets';
import { type Template } from '../../templates/TemplateLibrary';
import { gatedFeature, isProUnlocked } from '../utils/proGate';

/** Wizard key: Electron uses a separate key so browser dev `laserforge_setup_complete` does not skip the wizard in the packaged app. */
function getSetupStorageKey(): string {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      return 'laserforge_setup_complete_electron';
    }
  } catch { /* ignore */ }
  return 'laserforge_setup_complete';
}

// ─── COMPONENT ───────────────────────────────────────────────────

export function App() {
  const {
    modal,
    showAlert,
    showConfirm,
    showPrompt,
    dismissModal,
    finishAlert,
    finishConfirm,
    finishPrompt,
  } = useModal();
  const dialogs = useDialogs();
  const [zoomLevel, setZoomLevel] = useState(100);
  const viewportActionsRef = useRef<ViewportActions | null>(null);

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
  const [showMaterialLibrary, setShowMaterialLibrary] = useState(false);
  const [materialLibraryRev, setMaterialLibraryRev] = useState(0);
  const [materialDropdownOpen, setMaterialDropdownOpen] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showKerfWizard, setShowKerfWizard] = useState(false);
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
  const allProfiles = useMemo(() => {
    void profileRevision;
    return getDeviceProfiles();
  }, [profileRevision]);
  const handleSceneCommitRef = useRef<((newScene: Scene) => void) | null>(null);

  const refreshProfiles = useCallback(() => setProfileRevision(v => v + 1), []);
  const updateActiveProfile = useCallback((updates: Partial<DeviceProfile>) => {
    const current = getActiveProfile();
    if (!current) return;
    const updated: DeviceProfile = { ...current, ...updates };
    saveDeviceProfile(updated);
    refreshProfiles();
  }, [refreshProfiles]);
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
  }, [grbl.machineState]);
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

  useEffect(() => {
    if (!textPlacementHint) return;
    const id = window.setTimeout(() => setTextPlacementHint(null), 5000);
    return () => clearTimeout(id);
  }, [textPlacementHint]);

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
  useEffect(() => {
    handleSceneCommitRef.current = handleSceneCommit;
  }, [handleSceneCommit]);

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
  }, [showToolpathPreview, sceneCompileTick, compileToolpath, showAlert]);

  const handleConnectionRecompile = useCallback(() => {
    void (async () => {
      const gc = await compileGcode(scene);
      setCurrentGcode(gc);
    })();
  }, [scene, compileGcode, setCurrentGcode]);

  // Auto-recompile G-code when the design changes (debounced).
  // Replaces the manual "↻ Update" step in the connection panel.
  useEffect(() => {
    if (!connectionSidebarOpen) return;
    if (grbl.isJobRunning) return;
    if (!gcodeStale) return;

    const timer = setTimeout(() => {
      handleConnectionRecompile();
    }, 500);

    return () => clearTimeout(timer);
  }, [gcodeStale, connectionSidebarOpen, grbl.isJobRunning, handleConnectionRecompile]);

  const bumpCanvasRepaint = useCallback(() => {
    try {
      window.dispatchEvent(new Event('laserforge-canvas-repaint'));
    } catch { /* ignore */ }
  }, []);

  /** Connection sidebar edits arbitrary layers; LayerPanel’s mode UI is for `activeLayerId` only — align selection here. */
  const handleConnectionUpdateLayerMode = useCallback(
    (layerId: string, mode: LayerMode) => {
      const layer = scene.layers.find(l => l.id === layerId);
      if (!layer) return;
      let next = applyLayerModeChange(layer, mode);
      // Auto-rename if the name matches the old mode (e.g. "Cut" → "Engrave")
      const modeNames: Record<LayerMode, string> = { cut: 'Cut', engrave: 'Engrave', score: 'Score', image: 'Image' };
      if (layer.name.toLowerCase() === layer.settings.mode) {
        next = { ...next, name: modeNames[mode] };
      }
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => (l.id === layerId ? next : l)),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  const handleConnectionUpdateLayerSetting = useCallback(
    (layerId: string, key: 'powerMax' | 'speed' | 'passes', value: number) => {
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => {
          if (l.id !== layerId) return l;
          if (key === 'powerMax') {
            const v = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
            return { ...l, settings: { ...l.settings, power: { ...l.settings.power, max: v } } };
          }
          if (key === 'speed') {
            const v = Math.max(MIN_LASER_SPEED, Math.min(MAX_LASER_SPEED, Math.round(Number.isFinite(value) ? value : 1000)));
            return { ...l, settings: { ...l.settings, speed: v } };
          }
          const v = Math.max(1, Math.min(99, Math.round(Number.isFinite(value) ? value : 1)));
          return { ...l, settings: { ...l.settings, passes: v } };
        }),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  const handleConnectionUpdateLayerFillMode = useCallback(
    (layerId: string, fillMode: FillMode) => {
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => {
          if (l.id !== layerId) return l;
          const f = l.settings.fill;
          const interval = Number(f.interval) > 0 ? f.interval : 0.1;
          return {
            ...l,
            settings: {
              ...l.settings,
              fill: {
                ...f,
                enabled: true,
                mode: fillMode,
                interval,
              },
            },
          };
        }),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  const handleConnectionUpdateLayerFillInterval = useCallback(
    (layerId: string, intervalMm: number) => {
      const interval = Math.max(0.02, Math.min(1, Number.isFinite(intervalMm) ? intervalMm : 0.1));
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => {
          if (l.id !== layerId) return l;
          const f = l.settings.fill;
          return {
            ...l,
            settings: {
              ...l.settings,
              fill: {
                ...f,
                enabled: true,
                interval,
              },
            },
          };
        }),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  const handleConnectionUpdateLayerFillBidirectional = useCallback(
    (layerId: string, bidirectional: boolean) => {
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => {
          if (l.id !== layerId) return l;
          const f = l.settings.fill;
          return {
            ...l,
            settings: {
              ...l.settings,
              fill: {
                ...f,
                biDirectional: bidirectional,
              },
            },
          };
        }),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

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

  const handleRecover = useCallback(() => {
    try {
      const saved = localStorage.getItem('laserforge_autosave');
      if (saved) {
        const recovered = deserializeScene(saved);
        handleNewProject(recovered);
      }
    } catch (e) {
      console.error('Recovery failed:', e);
    }
    setShowRecover(false);
  }, [handleNewProject]);

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

  const handleWizardComplete = useCallback((result: WizardResult) => {
    dialogs.setShowSetup(false);
    try { localStorage.setItem(getSetupStorageKey(), 'true'); } catch { /* ignore */ }

    // Apply wizard results to scene
    const matX = Math.round((result.bedWidth - result.materialWidth) / 2);
    const matY = Math.round((result.bedHeight - result.materialHeight) / 2);

    const newScene = {
      ...scene,
      canvas: { ...scene.canvas, width: result.bedWidth, height: result.bedHeight },
      material: {
        enabled: true,
        x: matX,
        y: matY,
        width: result.materialWidth,
        height: result.materialHeight,
        thickness: result.materialThickness,
        type: result.materialType as NonNullable<Scene['material']>['type'],
        name: result.materialName,
        color: result.materialColor,
      },
      machine: {
        name: result.machineName || 'Custom',
        watts: result.machineWatts || '',
        type: result.machineType || 'diode',
      },
    };
    handleSceneCommit(newScene);

    // Fit to bed after a tick
    setTimeout(() => viewportActionsRef.current?.fitToBed(), 100);
  }, [scene, handleSceneCommit, dialogs.setShowSetup]);

  const handleWizardSkip = useCallback(() => {
    dialogs.setShowSetup(false);
    try { localStorage.setItem(getSetupStorageKey(), 'true'); } catch { /* ignore */ }
  }, [dialogs.setShowSetup]);

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

  const contextMenuActions = useMemo(
    () => ({
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
    }),
    [
      handleSceneCommit,
      handleCopy,
      handlePaste,
      handleDuplicate,
      handleDelete,
      dialogs.setShowTextDialog,
      dialogs.setEditingTextId,
      dialogs.setTextInput,
      dialogs.setTextFont,
      dialogs.setTextSize,
      dialogs.setTextBold,
      dialogs.setTextItalic,
      setTextPlacementPt,
      dialogs.setShowVariableText,
      dialogs.setVariableTextSource,
      sceneOps.alignObjects,
      sceneOps.centerOnCanvas,
      sceneOps.performBoolean,
      sceneOps.offsetSelected,
      sceneOps.convertTextToPath,
      showAlert,
      showPrompt,
      sceneOps.distributeObjects,
      sceneOps.moveToCorner,
      sceneOps.moveToMaterialOrigin,
      sceneOps.rotateSelected,
      sceneOps.flipSelected,
      sceneOps.toggleLock,
      sceneOps.toggleVisibility,
      setShowGridArray,
      setShowMaterialTest,
      setShowKerfWizard,
    ],
  );

  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu(
    scene,
    selectedIds,
    productionMode,
    contextMenuActions,
  );

  const syncAutosaveAfterFileSave = useCallback(() => {
    sceneIsDirtyRef.current = false;
    try {
      const json = serializeForAutosave(scene);
      localStorage.setItem('laserforge_autosave', json);
      localStorage.setItem('laserforge_autosave_time', new Date().toISOString());
      lastSavedSceneRef.current = json;
    } catch { /* ignore */ }
  }, [scene]);

  const handleKeyboardSave = useCallback(async () => {
    try {
      await saveSceneToFile(scene);
      syncAutosaveAfterFileSave();
    } catch (e) {
      await showAlert('Save Failed', 'Save failed: ' + (e as Error).message);
    }
  }, [scene, showAlert, syncAutosaveAfterFileSave]);

  const handleKeyboardOpen = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.laserforge.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const loadedScene = deserializeScene(text);
        handleNewProject(loadedScene);
      } catch (err) {
        await showAlert('Import Failed', 'Import failed: ' + (err as Error).message);
      }
    };
    input.click();
  }, [handleNewProject, showAlert]);

  const handleKeyboardNew = useCallback(async () => {
    if (scene.objects.length > 0) {
      const ok = await showConfirm('New Project', 'Start a new project? Unsaved changes will be lost.');
      if (!ok) return;
    }
    try { localStorage.removeItem('laserforge_autosave'); } catch { /* ignore */ }
    handleNewProject(createScene(scene.canvas.width, scene.canvas.height, 'Untitled'));
  }, [scene.canvas.width, scene.canvas.height, scene.objects.length, handleNewProject, showConfirm]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleQuickActionDuplicate = useCallback(() => {
    if (selectedIds.size === 0) return;
    const newIds = new Set<string>();
    const clones: typeof scene.objects = [];
    const parentIdMap = new Map<string, string>();
    for (const obj of scene.objects) {
      if (!selectedIds.has(obj.id)) continue;
      const newId = generateId();
      newIds.add(newId);
      let newParentId = obj.parentId;
      if (obj.parentId) {
        if (!parentIdMap.has(obj.parentId)) {
          parentIdMap.set(obj.parentId, generateId());
        }
        newParentId = parentIdMap.get(obj.parentId)!;
      }
      clones.push({
        ...obj,
        id: newId,
        parentId: newParentId,
        name: obj.name + ' copy',
        transform: { ...obj.transform, tx: obj.transform.tx + 5, ty: obj.transform.ty + 5 },
        _bounds: null,
        _worldTransform: null,
      });
    }
    const newScene = { ...scene, objects: [...scene.objects, ...clones] };
    handleSceneCommit(newScene);
    setSelectedIds(newIds);
  }, [scene, selectedIds, handleSceneCommit]);

  const handleQuickActionDelete = useCallback(() => {
    handleDelete();
  }, [handleDelete]);

  const handleQuickActionCenter = useCallback(() => {
    if (selectedIds.size === 0) return;
    sceneOps.centerOnMaterial();
  }, [selectedIds.size, sceneOps.centerOnMaterial]);

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

  const handleGridArrayConfirm = useCallback((config: GridArrayConfig) => {
    setShowGridArray(false);
    const selected = scene.objects.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of selected) {
      const b = computeObjectBounds(obj);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    const objW = maxX - minX;
    const objH = maxY - minY;
    const stepX = objW + config.spacingX;
    const stepY = objH + config.spacingY;

    const allClones: typeof scene.objects = [];

    for (let row = 0; row < config.rows; row++) {
      for (let col = 0; col < config.cols; col++) {
        if (row === 0 && col === 0) continue;

        const dx = col * stepX;
        const dy = row * stepY;
        const parentIdMap = new Map<string, string>();

        for (const obj of selected) {
          const newId = generateId();

          let newParentId = obj.parentId;
          if (obj.parentId) {
            const mapKey = `${obj.parentId}_${row}_${col}`;
            if (!parentIdMap.has(mapKey)) {
              parentIdMap.set(mapKey, generateId());
            }
            newParentId = parentIdMap.get(mapKey)!;
          }

          allClones.push({
            ...obj,
            id: newId,
            parentId: newParentId,
            name: obj.name,
            powerScale: obj.powerScale ?? 1,
            transform: { ...obj.transform, tx: obj.transform.tx + dx, ty: obj.transform.ty + dy },
            _bounds: null,
            _worldTransform: null,
          });
        }
      }
    }

    const newScene = { ...scene, objects: [...scene.objects, ...allClones] };
    handleSceneCommit(newScene);
  }, [scene, selectedIds, handleSceneCommit]);

  const handleNestingApply = useCallback((newObjects: SceneObject[]) => {
    const newScene = { ...scene, objects: newObjects };
    handleSceneCommit(newScene);
  }, [scene, handleSceneCommit]);

  const handleMaterialTestApply = useCallback((
    rawObjects: SceneObject[],
    layerSettings: Array<{ power: number; speed: number }>,
    testMode: 'cut' | 'engrave',
  ) => {
    const baseOrder = scene.layers.length;
    const newLayers: Layer[] = layerSettings.map((ls, i) => {
      const layer = createLayer(baseOrder + i, testMode, `Test P${ls.power} S${ls.speed}`);
      const p = Math.max(0, Math.min(100, ls.power));
      const sp = Math.max(1, ls.speed);
      return {
        ...layer,
        order: baseOrder + i,
        settings: {
          ...layer.settings,
          mode: testMode,
          power: { min: 0, max: p },
          speed: sp,
          fill: {
            ...layer.settings.fill,
            enabled: testMode === 'engrave',
          },
          airAssist: testMode === 'cut',
        },
      };
    });

    const layerIds = newLayers.map(l => l.id);
    let squareIndex = 0;
    const remapped = rawObjects.map(obj => {
      if (obj.name.startsWith('Test P')) {
        const lid = layerIds[squareIndex] ?? layerIds[0];
        squareIndex += 1;
        return { ...obj, layerId: lid };
      }
      if (obj.name.startsWith('Label P')) {
        const lid = layerIds[Math.max(0, squareIndex - 1)] ?? layerIds[0];
        return { ...obj, layerId: lid };
      }
      const lid = layerIds[0] ?? scene.layers[0]?.id ?? '';
      return { ...obj, layerId: lid };
    });

    handleSceneCommit({
      ...scene,
      layers: [...scene.layers, ...newLayers],
      objects: [...scene.objects, ...remapped],
    });
  }, [scene, handleSceneCommit]);

  const handleKerfGenerateTest = useCallback((objects: SceneObject[]) => {
    handleSceneCommit({
      ...scene,
      objects: [...scene.objects, ...objects],
    });
  }, [scene, handleSceneCommit]);

  const handleKerfApply = useCallback(async (offsetMm: number, objectIds: string[]) => {
    const idsSet = new Set(objectIds);
    const next: SceneObject[] = [];
    let changed = 0;
    for (const obj of scene.objects) {
      if (!idsSet.has(obj.id)) {
        next.push(obj);
        continue;
      }
      if (obj.locked || !obj.visible) {
        next.push(obj);
        continue;
      }
      const resultGeom = offsetObject(obj, offsetMm);
      if (!resultGeom) {
        next.push(obj);
        continue;
      }
      changed += 1;
      next.push({
        ...obj,
        type: 'path',
        name: obj.name.startsWith('Kerf Test') ? obj.name : `Kerf ${offsetMm >= 0 ? '+' : ''}${offsetMm.toFixed(3)}mm ${obj.name}`,
        transform: { ...IDENTITY_MATRIX },
        geometry: resultGeom,
        _bounds: null,
        _worldTransform: null,
      } as SceneObject);
    }
    if (changed === 0) {
      await showAlert('Kerf', 'Offset failed — select cut paths or shapes, or try a smaller kerf.');
      return;
    }
    handleSceneCommit({ ...scene, objects: next });
  }, [scene, handleSceneCommit, showAlert]);

  const handleKerfSaveToPreset = useCallback((kerfMm: number) => {
    try {
      localStorage.setItem('laserforge_kerf', String(kerfMm));
    } catch { /* ignore */ }
  }, []);

  const handleMaterialConfirm = useCallback((config: MaterialConfig) => {
    dialogs.setShowMaterial(false);
    const newScene = {
      ...scene,
      material: {
        ...config,
        x: (scene.canvas.width - config.width) / 2,
        y: (scene.canvas.height - config.height) / 2,
        color: '',
        enabled: true,
      },
    };
    handleSceneCommit(newScene);
  }, [scene, handleSceneCommit]);

  const handleMaterialClear = useCallback(() => {
    dialogs.setShowMaterial(false);
    handleSceneCommit({ ...scene, material: null });
  }, [scene, handleSceneCommit]);

  /** Apply a material preset — updates scene.material and adjusts ALL output layers. */
  const handleMaterialPresetApply = useCallback((presetName: string) => {
    const machineType = scene.machine?.type || 'diode';
    const machineWatts = scene.machine?.watts || '10';
    const settings = getPresetSettings(presetName, machineType, machineWatts);
    if (!settings) return;

    // Apply mode-appropriate settings to every output layer
    const newLayers = scene.layers.map(l => {
      if (!l.visible || l.output === false) return l;
      const mode = l.settings.mode;
      const s = mode === 'cut' ? settings.cut
        : mode === 'engrave' ? settings.engrave
        : mode === 'score' ? settings.score
        : settings.engrave;
      return {
        ...l,
        settings: {
          ...l.settings,
          power: { ...l.settings.power, max: s.power },
          speed: s.speed,
          passes: 'passes' in s ? s.passes : l.settings.passes,
        },
      };
    });

    // Determine material type from category
    const preset = getAllMaterials().find(p => p.name === presetName);
    const catMap: Record<string, NonNullable<Scene['material']>['type']> = {
      Acrylic: 'acrylic', Leather: 'leather', 'Paper & Card': 'paper',
      Fabric: 'fabric', Wood: 'wood', Plywood: 'wood', MDF: 'wood',
    };
    const matType = preset ? (catMap[preset.category] || 'custom') : 'custom';

    const matWidth = scene.canvas.width * 0.6;
    const matHeight = scene.canvas.height * 0.5;

    const updatedMaterial = scene.material
      ? { ...scene.material, name: presetName, type: matType, thickness: preset?.thickness ?? scene.material.thickness }
      : {
          type: matType, name: presetName,
          width: matWidth, height: matHeight,
          x: (scene.canvas.width - matWidth) / 2,
          y: (scene.canvas.height - matHeight) / 2,
          thickness: preset?.thickness ?? 3, color: '#c4956a', enabled: true,
        };

    handleSceneCommit({ ...scene, layers: newLayers, material: updatedMaterial });
    setMaterialDropdownOpen(false);
  }, [scene, handleSceneCommit]);

  const handleTemplateSelect = useCallback(async (template: Template) => {
    dialogs.setShowTemplates(false);
    try {
      const layerId = scene.activeLayerId || scene.layers[0]?.id;
      if (!layerId) return;
      const newScene = importSvgIntoScene(template.svg, scene, layerId, {
        mode: 'fit',
        allowScaleUp: false,
        targetBounds: scene.material
          ? {
            minX: scene.material.x,
            minY: scene.material.y,
            maxX: scene.material.x + scene.material.width,
            maxY: scene.material.y + scene.material.height,
          }
          : {
            minX: 0,
            minY: 0,
            maxX: scene.canvas.width,
            maxY: scene.canvas.height,
          },
      });
      handleSceneCommit(newScene);
    } catch (e) {
      await showAlert('Template', 'Failed to load template: ' + (e as Error).message);
    }
  }, [scene, handleSceneCommit, showAlert]);

  const handleBoxGenerate = useCallback((objects: SceneObject[]) => {
    const newScene = {
      ...scene,
      objects: [...scene.objects, ...objects],
    };
    handleSceneCommit(newScene);
    setSelectedIds(new Set(objects.map(o => o.id)));
  }, [scene, handleSceneCommit]);

  const handleVariableTextGenerate = useCallback((objects: SceneObject[]) => {
    const newScene = {
      ...scene,
      objects: [...scene.objects, ...objects],
    };
    handleSceneCommit(newScene);
    setSelectedIds(new Set(objects.map(o => o.id)));
  }, [scene, handleSceneCommit]);

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

  // ─── MATERIAL TOOLBAR HELPERS ──────────────────────────────

  const materialChipStyle = (type?: string) => {
    const styles: Record<string, { bg: string; border: string; text: string; icon: string }> = {
      wood:    { bg: 'rgba(139,90,43,0.10)', border: 'rgba(139,90,43,0.30)', text: '#C4956A', icon: '🪵' },
      acrylic: { bg: 'rgba(100,180,255,0.08)', border: 'rgba(100,180,255,0.25)', text: '#80C8FF', icon: '💎' },
      leather: { bg: 'rgba(160,82,45,0.10)', border: 'rgba(160,82,45,0.30)', text: '#C08060', icon: '🟤' },
      paper:   { bg: 'rgba(240,230,210,0.08)', border: 'rgba(200,190,170,0.25)', text: '#D4C8B0', icon: '📄' },
      fabric:  { bg: 'rgba(180,130,180,0.08)', border: 'rgba(180,130,180,0.25)', text: '#B882B8', icon: '🧵' },
      metal:   { bg: 'rgba(180,190,200,0.08)', border: 'rgba(180,190,200,0.25)', text: '#B4BEC8', icon: '⚙' },
      cardboard: { bg: 'rgba(170,130,80,0.08)', border: 'rgba(170,130,80,0.25)', text: '#C0A060', icon: '📦' },
    };
    return styles[type || ''] || { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)', text: '#8888a8', icon: '◻' };
  };

  const matToolbarBtn: React.CSSProperties = {
    width: 22, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: `1px solid ${theme.border.subtle}`, borderRadius: 4,
    background: '#12121f', color: theme.text.secondary, cursor: 'pointer',
    fontSize: 12, fontFamily: theme.font.ui, padding: 0,
  };

  const matDropdownItem: React.CSSProperties = {
    display: 'block', width: '100%', padding: '5px 12px', border: 'none',
    background: 'transparent', color: theme.text.secondary, fontSize: 11,
    textAlign: 'left' as const, cursor: 'pointer', fontFamily: theme.font.ui,
  };

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
      machineBedWidth: machineBedFromGrbl?.width ?? scene.canvas.width,
      machineBedHeight: machineBedFromGrbl?.height ?? scene.canvas.height,
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
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px',
            background: '#0e0e1a',
            borderBottom: `1px solid ${theme.border.subtle}`,
            flexShrink: 0,
            position: 'relative' as const,
            zIndex: 20,
          },
        },
          // Zoom controls
          React.createElement('button', {
            onClick: () => viewportActionsRef.current?.zoomOut(),
            style: { ...matToolbarBtn },
          }, '−'),
          React.createElement('span', {
            style: { color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, minWidth: 32, textAlign: 'center' as const },
          }, `${zoomLevel}%`),
          React.createElement('button', {
            onClick: () => viewportActionsRef.current?.zoomIn(),
            style: { ...matToolbarBtn },
          }, '+'),
          React.createElement('button', {
            onClick: () => viewportActionsRef.current?.fitToBed(),
            style: { ...matToolbarBtn, width: 'auto' as any, padding: '0 7px', fontSize: 9 },
          }, 'Fit'),
          // Divider
          React.createElement('div', { style: { width: 1, height: 16, background: theme.border.subtle } }),
          // Material chip
          React.createElement('div', { style: { position: 'relative' as const } },
            React.createElement('button', {
              onClick: () => setMaterialDropdownOpen(v => !v),
              style: {
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px 3px 7px',
                borderRadius: 16,
                border: `1px solid ${materialChipStyle(scene.material?.type).border}`,
                background: materialChipStyle(scene.material?.type).bg,
                color: materialChipStyle(scene.material?.type).text,
                cursor: 'pointer', fontSize: 11, fontWeight: 500,
                fontFamily: theme.font.ui,
              },
            },
              React.createElement('span', { style: { fontSize: 11 } }, materialChipStyle(scene.material?.type).icon),
              React.createElement('span', {}, scene.material?.name || 'No material'),
              React.createElement('span', { style: { fontSize: 7, marginLeft: 2, opacity: 0.5 } }, '▼'),
            ),
            // Dropdown
            materialDropdownOpen && React.createElement('div', {
              style: {
                position: 'absolute' as const, top: '100%', left: 0, marginTop: 4,
                width: 260, maxHeight: 340, overflowY: 'auto' as const,
                background: '#12121f', border: `1px solid ${theme.border.subtle}`,
                borderRadius: 8, padding: '4px 0',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                zIndex: 100,
              },
            },
              // No material option
              React.createElement('button', {
                onClick: () => { handleSceneCommit({ ...scene, material: null }); setMaterialDropdownOpen(false); },
                style: { ...matDropdownItem, color: theme.text.secondary },
              }, '◻ No material'),
              // Categorised presets
              ...MATERIAL_CATEGORIES.map(cat => {
                const presets = MATERIAL_PRESETS.filter(p => p.category === cat);
                if (presets.length === 0) return null;
                return React.createElement(React.Fragment, { key: cat },
                  React.createElement('div', {
                    style: { padding: '7px 12px 2px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: theme.text.tertiary },
                  }, cat),
                  ...presets.map(p =>
                    React.createElement('button', {
                      key: p.name,
                      onClick: () => handleMaterialPresetApply(p.name),
                      style: {
                        ...matDropdownItem,
                        fontWeight: scene.material?.name === p.name ? 600 : 400,
                        color: scene.material?.name === p.name ? theme.text.primary : theme.text.secondary,
                        background: scene.material?.name === p.name ? 'rgba(255,255,255,0.04)' : 'transparent',
                      },
                    }, p.name),
                  ),
                );
              }).filter(Boolean),
              // User materials
              (() => {
                const userMats = getUserMaterials();
                if (userMats.length === 0) return null;
                return React.createElement(React.Fragment, { key: 'user-mats' },
                  React.createElement('div', {
                    style: { padding: '7px 12px 2px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: theme.text.tertiary },
                  }, 'My Materials'),
                  ...userMats.map(m =>
                    React.createElement('button', {
                      key: m.id,
                      onClick: () => handleMaterialPresetApply(m.name),
                      style: { ...matDropdownItem },
                    }, `★ ${m.name}`),
                  ),
                );
              })(),
              // Manage library link
              React.createElement('div', { style: { height: 1, background: theme.border.subtle, margin: '4px 0' } }),
              React.createElement('button', {
                onClick: () => { setShowMaterialLibrary(true); setMaterialDropdownOpen(false); },
                style: { ...matDropdownItem, color: theme.text.accent },
              }, '+ Manage material library…'),
            ),
          ),
        ),
        // ── Canvas viewport ───────────────────────────────
        React.createElement('div', {
          style: { flex: 1, position: 'relative' as const, overflow: 'hidden' },
          onClick: () => materialDropdownOpen && setMaterialDropdownOpen(false),
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
          bedWidthMm: scene.canvas.width,
          bedHeightMm: scene.canvas.height,
          originCorner: activeProfile?.originCorner ?? 'front-left',
          onViewportLayout: handleViewportLayout,
          interactableLayerIds,
        }),
          React.createElement(ModeTabsOverlay, {
            viewportX: bedTabLayout.bedScreenX,
            viewportY: bedTabLayout.bedScreenY,
            viewportZoom: bedTabLayout.zoom,
            activeMode: activeLayerMode,
            onSelectMode: handleModeTabSelect,
            bedWidth: scene.canvas.width,
            bedHeight: scene.canvas.height,
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
        bedWidth: scene.canvas.width,
        bedHeight: scene.canvas.height,
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
        }),
      ),
    ),

    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '3px 12px',
        background: theme.bg.panel,
        borderTop: `1px solid ${theme.border.subtle}`,
        fontSize: theme.font.size.xs,
        fontFamily: theme.font.mono,
        color: theme.text.tertiary,
        height: 24,
        flexShrink: 0,
      },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        React.createElement('span', {
          style: { fontSize: '9px', color: '#333355', fontFamily: "'JetBrains Mono', monospace" },
        }, 'v0.1.0'),
        React.createElement('span', {}, scene.metadata.name || 'Untitled'),
        React.createElement('span', {
          style: {
            fontSize: 9, color: productionMode ? '#ffaa32' : '#2dd4a0',
            marginLeft: 8, opacity: 0.6,
          },
        }, productionMode ? 'Production Mode' : 'Beginner Mode'),
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        textPlacementHint && React.createElement('span', {
          style: {
            fontSize: '10px',
            color: '#ffaa32',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            maxWidth: 420,
          },
        }, textPlacementHint),
        React.createElement('span', {}, `${scene.canvas.width} × ${scene.canvas.height} mm`),
        React.createElement('span', {
          title: 'The laser head moves here before cutting begins, and returns here when done. Drag the green dot on the canvas to change.',
          style: {
            fontSize: '10px',
            color: '#2dd4a0',
            cursor: 'help',
            fontFamily: "'JetBrains Mono', monospace",
            borderBottom: '1px dotted #2dd4a0',
          },
        }, `⌂ ${scene.startPosition.x}, ${scene.startPosition.y}`),
        scene.material && (() => {
          const mat = scene.material;
          let outCount = 0;
          for (const obj of scene.objects) {
            if (!obj.visible) continue;
            const b = computeObjectBounds(obj);
            if (!b) continue;
            if (b.minX < mat.x || b.minY < mat.y ||
                b.maxX > mat.x + mat.width || b.maxY > mat.y + mat.height) {
              outCount++;
            }
          }
          if (outCount > 0) {
            return React.createElement('span', {
              style: { color: '#ff4466', fontSize: '10px', fontFamily: "'DM Sans', system-ui", display: 'flex', alignItems: 'center', gap: 3 },
            }, `⚠ ${outCount} object${outCount > 1 ? 's' : ''} outside material`);
          }
          return null;
        })(),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
          React.createElement('button', {
            onClick: () => viewportActionsRef.current?.zoomOut(),
            style: { background: 'none', border: 'none', color: '#8888aa', cursor: 'pointer', fontSize: 14, padding: '0 4px', fontFamily: "'DM Sans', system-ui" },
            title: 'Zoom out',
          }, '−'),
          React.createElement('span', {
            style: { fontSize: 10, color: '#555570', fontFamily: "'JetBrains Mono', monospace", minWidth: 40, textAlign: 'center' as const },
          }, `${zoomLevel}%`),
          React.createElement('button', {
            onClick: () => viewportActionsRef.current?.zoomIn(),
            style: { background: 'none', border: 'none', color: '#8888aa', cursor: 'pointer', fontSize: 14, padding: '0 4px', fontFamily: "'DM Sans', system-ui" },
            title: 'Zoom in',
          }, '+'),
          React.createElement('button', {
            onClick: () => viewportActionsRef.current?.fitToBed(),
            style: { background: 'none', border: '1px solid #252540', borderRadius: 3, color: '#8888aa', cursor: 'pointer', fontSize: 9, padding: '2px 6px', fontFamily: "'DM Sans', system-ui", marginLeft: 4 },
            title: 'Fit to bed',
          }, 'FIT'),
        ),
      ),
    ),

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
      bedWidth: scene.canvas.width,
      bedHeight: scene.canvas.height,
      onClose: () => setGcodePreview(null),
    }),

    dialogs.showMaterial && React.createElement(MaterialDialog, {
      bedWidth: scene.canvas.width,
      bedHeight: scene.canvas.height,
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

    dialogs.showTextDialog && React.createElement('div', {
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 2000, fontFamily: "'DM Sans', system-ui, sans-serif",
      },
      onClick: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
          dialogs.closeTextDialog();
          setTextPlacementPt(null);
        }
      },
    },
      React.createElement('div', {
        style: {
          background: '#12121e', border: '1px solid #252540', borderRadius: 14,
          width: 420, padding: 0, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('div', {
          style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        },
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, dialogs.editingTextId ? 'Edit Text' : 'Add Text'),
          React.createElement('button', {
            onClick: () => {
              dialogs.closeTextDialog();
              setTextPlacementPt(null);
            },
            style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
          }, '×'),
        ),

        React.createElement('div', { style: { padding: '16px 18px' } },
          React.createElement('textarea', {
            value: dialogs.textInput,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => dialogs.setTextInput(e.target.value),
            placeholder: 'Type your text here...',
            autoFocus: true,
            rows: 3,
            style: {
              width: '100%', padding: '10px 12px',
              background: '#0a0a14', border: '1px solid #252540', borderRadius: 8,
              color: '#e0e0ec', fontSize: 14, fontFamily: dialogs.textFont,
              fontWeight: dialogs.textBold ? 'bold' : 'normal',
              fontStyle: dialogs.textItalic ? 'italic' : 'normal',
              outline: 'none', resize: 'vertical' as const,
            },
          }),
        ),

        React.createElement('div', { style: { padding: '0 18px 12px', display: 'flex', gap: 8 } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Font'),
            React.createElement('select', {
              value: dialogs.textFont,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => dialogs.setTextFont(e.target.value),
              style: {
                width: '100%', padding: '6px 8px',
                background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
                color: '#e0e0ec', fontSize: 12, outline: 'none',
                fontFamily: "'DM Sans', system-ui, sans-serif",
              },
            },
              ...['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Impact', 'Comic Sans MS', 'Trebuchet MS', 'Palatino', 'Garamond', 'Bookman', 'Avant Garde'].map(f =>
                React.createElement('option', { key: f, value: f, style: { fontFamily: f } }, f),
              ),
            ),
          ),
          React.createElement('div', { style: { width: 80 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Size (mm)'),
            React.createElement(NumberInput, {
              value: dialogs.textSize,
              min: 3,
              max: 200,
              integer: true,
              inputMode: 'numeric',
              defaultValue: 20,
              onChange: (v: number) => dialogs.setTextSize(v),
              onCommit: (v: number) => dialogs.setTextSize(v),
              style: {
                width: '100%', padding: '6px 8px',
                background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
                color: '#e0e0ec', fontSize: 12, outline: 'none',
                fontFamily: "'JetBrains Mono', monospace",
              },
            }),
          ),
        ),

        React.createElement('div', { style: { padding: '0 18px 12px', display: 'flex', gap: 8 } },
          React.createElement('button', {
            onClick: () => dialogs.setTextBold(!dialogs.textBold),
            style: {
              padding: '6px 16px', fontSize: 13, fontWeight: 700,
              background: dialogs.textBold ? 'rgba(0,212,255,0.1)' : '#0a0a14',
              border: dialogs.textBold ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 6, color: dialogs.textBold ? '#00d4ff' : '#555570',
              cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
            },
          }, 'B'),
          React.createElement('button', {
            onClick: () => dialogs.setTextItalic(!dialogs.textItalic),
            style: {
              padding: '6px 16px', fontSize: 13, fontStyle: 'italic',
              background: dialogs.textItalic ? 'rgba(0,212,255,0.1)' : '#0a0a14',
              border: dialogs.textItalic ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 6, color: dialogs.textItalic ? '#00d4ff' : '#555570',
              cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
            },
          }, 'I'),
        ),

        React.createElement('div', {
          style: {
            margin: '0 18px 12px', padding: '16px',
            background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e',
            minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
        },
          React.createElement('span', {
            style: {
              fontFamily: dialogs.textFont, fontSize: Math.min(dialogs.textSize * 2, 48),
              fontWeight: dialogs.textBold ? 'bold' : 'normal',
              fontStyle: dialogs.textItalic ? 'italic' : 'normal',
              color: '#e0e0ec',
            },
          }, dialogs.textInput || 'Preview'),
        ),

        React.createElement('div', { style: { padding: '0 18px 16px' } },
          React.createElement('button', {
            onClick: () => {
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
            },
            disabled: !dialogs.textInput.trim(),
            style: {
              width: '100%', padding: '10px',
              background: dialogs.textInput.trim() ? 'rgba(45,212,160,0.1)' : '#1a1a2e',
              border: dialogs.textInput.trim() ? '1px solid #2dd4a0' : '1px solid #252540',
              borderRadius: 8, color: dialogs.textInput.trim() ? '#2dd4a0' : '#333355',
              fontSize: 13, fontWeight: 600, cursor: dialogs.textInput.trim() ? 'pointer' : 'default',
              fontFamily: "'DM Sans', system-ui, sans-serif",
            },
          }, dialogs.editingTextId ? 'Update Text' : 'Add Text to Canvas'),

          React.createElement('div', {
            style: { fontSize: 10, color: '#555570', marginTop: 8, textAlign: 'center' as const },
          }, 'After adding, select the text and click "Convert to Path" before cutting'),
        ),
      ),
    ),

    modal && React.createElement(AppModal, {
      title: modal.title,
      message: modal.message,
      details: modal.details,
      onClose: dismissModal,
      prompt: modal.variant === 'prompt'
        ? { defaultValue: modal.defaultValue, placeholder: modal.placeholder }
        : undefined,
      onPromptSubmit: modal.variant === 'prompt' ? (v: string) => finishPrompt(v) : undefined,
      buttons: modal.variant === 'alert'
        ? [{ label: 'OK', action: finishAlert, primary: true }]
        : modal.variant === 'confirm'
          ? [
              { label: 'Cancel', action: () => finishConfirm(false) },
              { label: 'OK', action: () => finishConfirm(true), primary: true },
            ]
          : [
              { label: 'Cancel', action: () => finishPrompt(null) },
              { label: 'OK', action: () => {}, primary: true },
            ],
    }),
  );
}
