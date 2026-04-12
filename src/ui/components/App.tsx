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
import { useGcodeExport } from '../hooks/useGcodeExport';
import { compileJob } from '../../core/job/JobCompiler';
import { optimizePlan } from '../../core/plan/PlanOptimizer';
import { type Move } from '../../core/plan/Plan';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDialogs } from '../hooks/useDialogs';
import { useSceneOperations } from '../hooks/useSceneOperations';
import { useGrblConnection } from '../hooks/useGrblConnection';
import { CanvasViewport } from './CanvasViewport';
import { LayerPanel } from './LayerPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { ToolBar, type ToolType } from './ToolBar';
import { ContextMenu } from './ContextMenu';
import { GridArrayDialog, type GridArrayConfig } from './GridArrayDialog';
import { MaterialTestDialog } from './MaterialTestDialog';
import { GcodePreview } from './GcodePreview';
import { MaterialDialog, type MaterialConfig } from './MaterialDialog';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { deserializeScene, serializeScene } from '../../io/SceneSerializer';
import { saveSceneToFile } from '../../io/FileIO';
import { generateId, IDENTITY_MATRIX } from '../../core/types';
import { createLayer, type Layer, type LayerMode, type FillMode } from '../../core/scene/Layer';
import { applyLayerModeChange } from '../../core/scene/layerModeTransition';
import { type SceneObject } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { offsetObject } from '../../geometry/OffsetPath';
import { theme } from '../styles/theme';
import { WelcomeWizard, type WizardResult } from './WelcomeWizard';
import { ShortcutsPanel } from './ShortcutsPanel';
import { QuickActions } from './QuickActions';
import { ConnectionPanel } from './ConnectionPanel';
import { TemplateBrowser } from './TemplateBrowser';
import { BoxGenerator } from './BoxGenerator';
import { NestingDialog } from './NestingDialog';
import { MaterialLibraryDialog } from './MaterialLibraryDialog';
import { CameraDialog } from './CameraDialog';
import { type StartMode } from './StartPositionWizard';
import { KerfWizard } from './KerfWizard';
import { VariableTextDialog } from './VariableTextDialog';
import { NumberInput } from './NumberInput';
import { LearnedToast } from './LearnedToast';
import { getSuggestion, type MaterialSuggestion } from '../../core/materials/MaterialFeedback';
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
  const viewportActionsRef = useRef<{ zoomIn: () => void; zoomOut: () => void; fitToBed: () => void } | null>(null);

  const [scene, setScene] = useState<Scene>(() => {
    const initial = createScene(400, 300, 'Untitled');
    return initial;
  });

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
  const [quickActionPos, setQuickActionPos] = useState<{ x: number; y: number } | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [isDragOver, setIsDragOver] = useState(false);
  const [showGridArray, setShowGridArray] = useState(false);
  const [showNesting, setShowNesting] = useState(false);
  const [gridArrayBounds, setGridArrayBounds] = useState({ w: 0, h: 0 });
  const [showMaterialTest, setShowMaterialTest] = useState(false);
  const [showMaterialLibrary, setShowMaterialLibrary] = useState(false);
  const [materialLibraryRev, setMaterialLibraryRev] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [showKerfWizard, setShowKerfWizard] = useState(false);
  const [startMode, setStartMode] = useState<StartMode>(() => {
    try {
      const raw = localStorage.getItem('laserforge_start_mode');
      if (raw === 'absolute' || raw === 'current' || raw === 'savedOrigin') return raw;
    } catch { /* ignore */ }
    return 'current';
  });
  const [savedOrigin, setSavedOrigin] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem('laserforge_saved_origin');
      return raw ? JSON.parse(raw) as { x: number; y: number } : null;
    } catch {
      return null;
    }
  });
  const [gcodePreview, setGcodePreview] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [activeJobMoves, setActiveJobMoves] = useState<readonly Move[] | null>(null);
  const [activeJobPlanMin, setActiveJobPlanMin] = useState<{ minX: number; minY: number } | null>(null);
  const grbl = useGrblConnection();
  const wasJobRunningRef = useRef(false);

  function computePlanMoveMinFromMoves(moves: readonly Move[]): { minX: number; minY: number } {
    let minX = Infinity;
    let minY = Infinity;
    for (const m of moves) {
      if (m.type === 'rapid' || m.type === 'linear') {
        minX = Math.min(minX, m.to.x);
        minY = Math.min(minY, m.to.y);
      }
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0 };
    return { minX, minY };
  }

  useEffect(() => {
    if (grbl.isJobRunning && !wasJobRunningRef.current) {
      try {
        const job = compileJob(scene);
        if (job.operations.length === 0) {
          setActiveJobMoves(null);
          setActiveJobPlanMin(null);
        } else {
          const plan = optimizePlan(job);
          const moves = plan.operations.flatMap(op => op.moves);
          setActiveJobMoves(moves);
          setActiveJobPlanMin(computePlanMoveMinFromMoves(moves));
        }
      } catch {
        setActiveJobMoves(null);
        setActiveJobPlanMin(null);
      }
    } else if (!grbl.isJobRunning && wasJobRunningRef.current) {
      setActiveJobMoves(null);
      setActiveJobPlanMin(null);
    }
    wasJobRunningRef.current = grbl.isJobRunning;
  }, [grbl.isJobRunning, scene]);

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
    if (activeJobPlanMin) {
      return {
        x: wp.x + activeJobPlanMin.minX,
        y: wp.y + activeJobPlanMin.minY,
      };
    }
    return { x: wp.x, y: wp.y };
  }, [grbl.isJobRunning, grbl.machineState, activeJobPlanMin]);

  const connectionSidebarOpen = dialogs.showConnection && grbl.grblReady;
  const connectionSidebarWidth = connectionSidebarOpen ? 450 : 0;
  const layersPanelWidth = connectionSidebarOpen ? 0 : 240;
  const toolbarWidth = 36;
  const canvasViewportWidth =
    canvasSize.width - toolbarWidth - connectionSidebarWidth - layersPanelWidth;

  const toolbarLaserConnected = useMemo(() => {
    const s = grbl.machineState;
    return !!s && s.status !== 'disconnected' && s.status !== 'connecting';
  }, [grbl.machineState]);

  const startModeRef = useRef(startMode);
  startModeRef.current = startMode;

  useEffect(() => {
    if (grbl.machineState?.status === 'disconnected' && startModeRef.current === 'current') {
      setStartMode('absolute');
      try {
        localStorage.setItem('laserforge_start_mode', 'absolute');
      } catch { /* ignore */ }
    }
  }, [grbl.machineState?.status]);

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

  const handleExit = useCallback(() => {
    if (sceneIsDirtyRef.current) {
      const confirmed = confirm('You have unsaved changes. Are you sure you want to exit?');
      if (!confirmed) return;
    }

    if (window.electronAPI?.quit) {
      void window.electronAPI.quit();
      return;
    }

    window.location.href = '/landing.html';
  }, []);

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
  });

  /** New project: reset history entirely and start fresh. */
  const handleNewProject = useCallback((newScene: Scene) => {
    sceneIsDirtyRef.current = false;
    historyRef.current.reset(newScene);
    setScene(newScene);
  }, []);

  const { currentGcode, setCurrentGcode, compileGcode } = useGcodeExport(startMode, savedOrigin);

  const lastCompiledSceneRef = useRef('');
  const [gcodeStale, setGcodeStale] = useState(false);

  const sceneCompileFingerprint = useCallback(
    (s: Scene) =>
      JSON.stringify({
        objects: s.objects.map(o => ({ id: o.id, transform: o.transform, geometry: o.geometry, layerId: o.layerId })),
        startMode,
        savedOrigin,
      }),
    [startMode, savedOrigin],
  );

  useEffect(() => {
    if (!connectionSidebarOpen) return;
    const currentKey = sceneCompileFingerprint(scene);
    if (lastCompiledSceneRef.current && currentKey !== lastCompiledSceneRef.current) {
      setGcodeStale(true);
    }
  }, [scene.objects, connectionSidebarOpen, sceneCompileFingerprint, scene]);

  const handleConnectionRecompile = useCallback(() => {
    const gc = compileGcode(scene);
    setCurrentGcode(gc);
    lastCompiledSceneRef.current = sceneCompileFingerprint(scene);
    setGcodeStale(false);
  }, [scene, compileGcode, setCurrentGcode, sceneCompileFingerprint]);

  const handleConnectionUpdateLayerMode = useCallback(
    (layerId: string, mode: LayerMode) => {
      const layer = scene.layers.find(l => l.id === layerId);
      if (!layer) return;
      const next = applyLayerModeChange(layer, mode);
      handleSceneCommit({
        ...scene,
        layers: scene.layers.map(l => (l.id === layerId ? next : l)),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
    },
    [scene, handleSceneCommit, connectionSidebarOpen],
  );

  const handleConnectionUpdateLayerFillMode = useCallback(
    (layerId: string, fillMode: FillMode) => {
      handleSceneCommit({
        ...scene,
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
    },
    [scene, handleSceneCommit, connectionSidebarOpen],
  );

  const handleConnectionUpdateLayerFillInterval = useCallback(
    (layerId: string, intervalMm: number) => {
      const interval = Math.max(0.02, Math.min(1, Number.isFinite(intervalMm) ? intervalMm : 0.1));
      handleSceneCommit({
        ...scene,
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
    },
    [scene, handleSceneCommit, connectionSidebarOpen],
  );

  const handleConnectionUpdateLayerFillBidirectional = useCallback(
    (layerId: string, bidirectional: boolean) => {
      handleSceneCommit({
        ...scene,
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
    },
    [scene, handleSceneCommit, connectionSidebarOpen],
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
        const json = serializeScene(scene);

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

  const handleKeyboardSave = useCallback(async () => {
    try {
      saveSceneToFile(scene);
      try {
        const serialized = serializeScene(scene);
        localStorage.setItem('laserforge_autosave', serialized);
        localStorage.setItem('laserforge_autosave_time', new Date().toISOString());
      } catch { /* ignore */ }
    } catch (e) {
      await showAlert('Save Failed', 'Save failed: ' + (e as Error).message);
    }
  }, [scene, showAlert]);

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
    setQuickActionPos(null);
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
    setQuickActionPos(null);
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
      const gc = compileGcode(scene);
      if (!gc) {
        await showAlert('No Objects', 'No objects to process. Add objects to an output layer first.');
      }
      setCurrentGcode(gc);
      lastCompiledSceneRef.current = sceneCompileFingerprint(scene);
      setGcodeStale(false);
    } catch (err) {
      console.error('G-code build failed:', err);
      setCurrentGcode(null);
    }
    dialogs.setShowConnection(true);
  }, [scene, compileGcode, showAlert, sceneCompileFingerprint]);

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
      selection: objects.map(o => o.id),
    };
    handleSceneCommit(newScene);
    setSelectedIds(new Set(objects.map(o => o.id)));
  }, [scene, handleSceneCommit]);

  const handleVariableTextGenerate = useCallback((objects: SceneObject[]) => {
    const newScene = {
      ...scene,
      objects: [...scene.objects, ...objects],
      selection: objects.map(o => o.id),
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
          try {
            const gc = compileGcode(scene);
            if (gc) setGcodePreview(gc);
          } catch (err) {
            console.error('G-code generation failed:', err);
          }
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
        compileGcode,
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
      showAlert,
      showConfirm,
      onConnect: handleConnect,
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
      onToolpathPreview: async () => {
        try {
          const gc = compileGcode(scene);
          if (gc) setGcodePreview(gc);
        } catch (err) {
          await showAlert('Preview Failed', 'Toolpath preview failed: ' + (err as Error).message);
        }
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
        style: { flex: 1, position: 'relative' as const, overflow: 'hidden', minWidth: 0 },
      },
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
          onSelectionScreenPos: setQuickActionPos,
          onRequestTextPlacement: handleRequestTextPlacement,
          onActiveTool: setActiveTool,
          onEditText: handleEditText,
          livePosition: liveJobCanvasPosition,
          isJobRunning: grbl.isJobRunning,
          jobProgress: grbl.jobProgress,
          activeJobMoves,
        }),
      ),
      connectionSidebarOpen && React.createElement(ConnectionPanel, {
        controller: grbl.controller!,
        portRef: grbl.portRef,
        machineState: grbl.machineState,
        jobProgress: grbl.jobProgress,
        scene,
        productionMode,
        gcode: currentGcode,
        onClose: () => dialogs.setShowConnection(false),
        onDisconnect: () => dialogs.setShowConnection(false),
        bedWidth: scene.canvas.width,
        bedHeight: scene.canvas.height,
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
        machinePosition: machinePositionForStartWizard,
        onSelectMode: (mode) => handleSelectStartMode(mode, machinePositionForStartWizard ?? scene.startPosition),
        onSaveOrigin: handleSaveOrigin,
        gcodeStale,
        onRecompile: handleConnectionRecompile,
        onUpdateLayerMode: handleConnectionUpdateLayerMode,
        onUpdateLayerFillMode: handleConnectionUpdateLayerFillMode,
        onUpdateLayerFillInterval: handleConnectionUpdateLayerFillInterval,
        onUpdateLayerFillBidirectional: handleConnectionUpdateLayerFillBidirectional,
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
          materialLibraryRev,
          onMaterialLibraryBump: () => setMaterialLibraryRev(r => r + 1),
        }),
        React.createElement('div', {
          style: {
            flex: 1,
            overflowY: 'auto' as const,
            minHeight: 0,
          },
        },
          React.createElement(PropertiesPanel, {
            scene,
            selectedIds,
            onSceneCommit: handleSceneCommit,
            onSceneChange: handleSceneChange,
            onSelectionChange: setSelectedIds,
            showAlert,
            handleTextToPath: () => void sceneOps.textToPath(),
            productionMode,
          }),
        ),
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

    quickActionPos && selectedIds.size > 0 && !previewMode && React.createElement(QuickActions, {
      x: quickActionPos.x,
      y: quickActionPos.y,
      selectedCount: selectedIds.size,
      onDuplicate: handleQuickActionDuplicate,
      onDelete: handleQuickActionDelete,
      onCenter: handleQuickActionCenter,
      onGridArray: handleGridArray,
      hasSelectedText,
      handleTextToPath: () => void sceneOps.textToPath(),
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
                  selection: [textObj.id],
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
