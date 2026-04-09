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
import { useContextMenu } from '../hooks/useContextMenu';
import { CanvasViewport } from './CanvasViewport';
import { LayerPanel } from './LayerPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { ToolBar, type ToolType } from './ToolBar';
import { ContextMenu } from './ContextMenu';
import { GridArrayDialog, type GridArrayConfig } from './GridArrayDialog';
import { MaterialTestDialog, type MaterialTestConfig } from './MaterialTestDialog';
import { GcodePreview } from './GcodePreview';
import { MaterialDialog, type MaterialConfig } from './MaterialDialog';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { deserializeScene, serializeScene } from '../../io/SceneSerializer';
import { saveSceneToFile } from '../../io/FileIO';
import { generateId, IDENTITY_MATRIX } from '../../core/types';
import { booleanOperation, type BooleanOp } from '../../geometry/BooleanOps';
import { textToPath } from '../../geometry/TextToPath';
import { offsetObject } from '../../geometry/OffsetPath';
import { createLayer } from '../../core/scene/Layer';
import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { theme } from '../styles/theme';
import { WelcomeWizard, type WizardResult } from './WelcomeWizard';
import { ShortcutsPanel } from './ShortcutsPanel';
import { QuickActions } from './QuickActions';
import { GrblController } from '../../controllers/grbl/GrblController';
import { MockSerialPort } from '../../communication/SerialPort';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { ConnectionPanel } from './ConnectionPanel';
import { TemplateBrowser } from './TemplateBrowser';
import { BoxGenerator } from './BoxGenerator';
import { VariableTextDialog } from './VariableTextDialog';
import { NumberInput } from './NumberInput';
import { LearnedToast } from './LearnedToast';
import { getSuggestion, type MaterialSuggestion } from '../../core/materials/MaterialFeedback';
import { type Template } from '../../templates/TemplateLibrary';

/** Wizard key: Electron uses a separate key so browser dev `laserforge_setup_complete` does not skip the wizard in the packaged app. */
function getSetupStorageKey(): string {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      return 'laserforge_setup_complete_electron';
    }
  } catch { /* ignore */ }
  return 'laserforge_setup_complete';
}

function alignSelection(scn: Scene, selIds: ReadonlySet<string>, alignment: string): Scene {
  const selected = scn.objects.filter(o => selIds.has(o.id));
  if (selected.length === 0) return scn;

  // computeObjectBounds returns LOCAL space bounds (before transform)
  // But we were multiplying by transform again — double transform!
  // Instead, compute world bounds manually from tx/ty and local bounds * scale

  let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;

  for (const o of selected) {
    const b = computeObjectBounds(o);
    if (!b) continue;
    const t = o.transform;

    // World position = local * scale + translate
    // But bounds might ALREADY be in world space if computeObjectBounds applies transform
    // Use bounds directly as world coords (don't multiply by transform)
    const x1 = b.minX;
    const y1 = b.minY;
    const x2 = b.maxX;
    const y2 = b.maxY;

    wMinX = Math.min(wMinX, x1);
    wMinY = Math.min(wMinY, y1);
    wMaxX = Math.max(wMaxX, x2);
    wMaxY = Math.max(wMaxY, y2);
  }

  if (!isFinite(wMinX)) return scn;

  let dx = 0, dy = 0;

  switch (alignment) {
    case 'center': {
      const targetCx = scn.material
        ? scn.material.x + scn.material.width / 2
        : scn.canvas.width / 2;
      const targetCy = scn.material
        ? scn.material.y + scn.material.height / 2
        : scn.canvas.height / 2;
      dx = targetCx - (wMinX + wMaxX) / 2;
      dy = targetCy - (wMinY + wMaxY) / 2;
      break;
    }
    case 'left': {
      const edge = scn.material?.enabled ? scn.material.x : 0;
      dx = edge - wMinX;
      break;
    }
    case 'right': {
      const edge = scn.material?.enabled ? scn.material.x + scn.material.width : scn.canvas.width;
      dx = edge - wMaxX;
      break;
    }
    case 'top': {
      const edge = scn.material?.enabled ? scn.material.y : 0;
      dy = edge - wMinY;
      break;
    }
    case 'bottom': {
      const edge = scn.material?.enabled ? scn.material.y + scn.material.height : scn.canvas.height;
      dy = edge - wMaxY;
      break;
    }
  }

  return {
    ...scn,
    objects: scn.objects.map(o => {
      if (!selIds.has(o.id)) return o;
      return {
        ...o,
        transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy },
        _bounds: null, _worldTransform: null,
      };
    }),
  };
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
  const [gridArrayBounds, setGridArrayBounds] = useState({ w: 0, h: 0 });
  const [showMaterialTest, setShowMaterialTest] = useState(false);
  const [showMaterialDialog, setShowMaterialDialog] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showBoxGenerator, setShowBoxGenerator] = useState(false);
  const [showVariableText, setShowVariableText] = useState(false);
  const [variableTextSource, setVariableTextSource] = useState<SceneObject | null>(null);
  const [gcodePreview, setGcodePreview] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [machineState, setMachineState] = useState<MachineState | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const grblControllerRef = useRef<GrblController | null>(null);
  const serialPortRef = useRef<WebSerialPort | MockSerialPort | null>(null);
  const sceneIsDirtyRef = useRef(false);
  const lastSavedSceneRef = useRef('');
  const [grblReady, setGrblReady] = useState(false);
  const [productionMode, setProductionMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('laserforge_production_mode') === 'true';
    } catch {
      return false;
    }
  });
  const handleToggleProductionMode = useCallback(() => {
    const newMode = !productionMode;
    setProductionMode(newMode);
    try {
      localStorage.setItem('laserforge_production_mode', String(newMode));
    } catch { /* ignore */ }
  }, [productionMode]);
  const [showWizard, setShowWizard] = useState(() => {
    try {
      return !localStorage.getItem(getSetupStorageKey());
    } catch {
      return true;
    }
  });
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
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textFont, setTextFont] = useState('Arial');
  const [textSize, setTextSize] = useState(20);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textPlacementPt, setTextPlacementPt] = useState<{ x: number; y: number } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  useEffect(() => {
    if (!textPlacementHint) return;
    const id = window.setTimeout(() => setTextPlacementHint(null), 5000);
    return () => clearTimeout(id);
  }, [textPlacementHint]);

  const handleTextPlaced = useCallback(() => {
    setTextPlacementHint('Tip: Select text and click "Convert to Path" before cutting');
  }, []);

  const handleRequestTextPlacement = useCallback((world: { x: number; y: number }) => {
    setEditingTextId(null);
    setTextPlacementPt({ x: world.x, y: world.y });
    setShowTextDialog(true);
  }, []);

  const handleEditText = useCallback((obj: SceneObject) => {
    const geom = obj.geometry as TextGeometry;
    setTextInput(geom.text || '');
    setTextFont(geom.fontFamily || 'Arial');
    setTextSize(geom.fontSize || 20);
    setTextBold(geom.bold || false);
    setTextItalic(geom.italic || false);
    setEditingTextId(obj.id);
    setTextPlacementPt(null);
    setShowTextDialog(true);
    setSelectedIds(new Set([obj.id]));
  }, []);

  useEffect(() => {
    const ctrl = new GrblController();
    ctrl.onStateChange((state) => setMachineState({ ...state }));
    ctrl.onProgress((prog) => setJobProgress({ ...prog }));
    grblControllerRef.current = ctrl;
    setGrblReady(true);

    return () => {
      try {
        if (ctrl.isJobRunning) {
          ctrl.stop();
        }
        ctrl.sendCommand('M5 S0');
      } catch { /* ignore */ }
      void ctrl.disconnect();
    };
  }, []);

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
          setShowWizard(true);
        }
      } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, []);

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

  /** New project: reset history entirely and start fresh. */
  const handleNewProject = useCallback((newScene: Scene) => {
    historyRef.current.reset(newScene);
    setScene(newScene);
  }, []);

  const { currentGcode, setCurrentGcode, compileGcode } = useGcodeExport();
  const { clipboard, handleCopy, handlePaste, handleDuplicate } = useClipboard(
    scene,
    selectedIds,
    handleSceneCommit,
    (ids) => setSelectedIds(ids),
  );
  const { handleDragOver, handleDragLeave, handleDrop } = useImport(scene, {
    handleSceneCommit,
    handleNewProject,
    setIsDragOver,
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
    setShowWizard(false);
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
  }, [scene, handleSceneCommit]);

  const handleWizardSkip = useCallback(() => {
    setShowWizard(false);
    try { localStorage.setItem(getSetupStorageKey(), 'true'); } catch { /* ignore */ }
  }, []);

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
      setShowTextDialog,
      setEditingTextId,
      setTextInput,
      setTextFont,
      setTextSize,
      setTextBold,
      setTextItalic,
      setTextPlacementPt,
      setShowVariableText,
      setVariableTextSource,
    }),
    [
      handleSceneCommit,
      handleCopy,
      handlePaste,
      handleDuplicate,
      handleDelete,
      setShowTextDialog,
      setEditingTextId,
      setTextInput,
      setTextFont,
      setTextSize,
      setTextBold,
      setTextItalic,
      setTextPlacementPt,
      setShowVariableText,
      setVariableTextSource,
    ],
  );

  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu(scene, selectedIds, contextMenuActions);

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
        handleNewProject(deserializeScene(text));
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
    handleSceneCommit(alignSelection(scene, selectedIds, 'center'));
  }, [scene, selectedIds, handleSceneCommit]);

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
    } catch (err) {
      console.error('G-code build failed:', err);
      setCurrentGcode(null);
    }
    setShowConnection(true);
  }, [scene, compileGcode, showAlert]);

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

  const handleBooleanOp = useCallback(async (op: BooleanOp) => {
    const ids = [...selectedIds];
    if (ids.length !== 2) {
      await showAlert('Boolean', 'Select exactly 2 objects for boolean operations.');
      return;
    }

    const objA = scene.objects.find(o => o.id === ids[0]);
    const objB = scene.objects.find(o => o.id === ids[1]);
    if (!objA || !objB) return;

    const resultGeom = booleanOperation(objA, objB, op);

    if (!resultGeom) {
      await showAlert('Boolean', 'Boolean operation failed — shapes may not overlap.');
      return;
    }

    const newId = generateId();
    const newObj: SceneObject = {
      id: newId,
      type: 'path',
      name: `${op} result`,
      layerId: objA.layerId,
      parentId: null,
      transform: { ...IDENTITY_MATRIX },
      geometry: resultGeom,
      visible: true,
      locked: false,
      powerScale: 1,
      _bounds: null,
      _worldTransform: null,
    };

    const newScene = {
      ...scene,
      objects: [
        ...scene.objects.filter(o => !selectedIds.has(o.id)),
        newObj,
      ],
    };

    handleSceneCommit(newScene);
    setSelectedIds(new Set([newId]));
  }, [scene, selectedIds, handleSceneCommit, showAlert]);

  const handleTextToPath = useCallback(async () => {
    const textObjs = scene.objects.filter(
      o => selectedIds.has(o.id) && o.geometry.type === 'text'
    );

    if (textObjs.length === 0) {
      await showAlert('Text to Path', 'Select a text object first.');
      return;
    }

    const newObjects: SceneObject[] = [];
    const removeIds = new Set<string>();

    for (const obj of textObjs) {
      const geom = obj.geometry as TextGeometry;
      const result = await textToPath(
        geom.text || '',
        geom.fontFamily || 'Arial',
        geom.fontSize || 20,
        geom.bold ?? false
      );

      if (!result) continue;

      removeIds.add(obj.id);

      newObjects.push({
        id: generateId(),
        type: 'path',
        name: `Path: "${geom.text}"`,
        layerId: obj.layerId,
        parentId: null,
        transform: { ...obj.transform },
        geometry: {
          type: 'path',
          subPaths: result.subPaths,
        },
        visible: true,
        locked: false,
        powerScale: obj.powerScale ?? 1,
        _bounds: null,
        _worldTransform: null,
      });
    }

    if (newObjects.length === 0) {
      await showAlert('Text to Path', 'Text to path conversion failed.');
      return;
    }

    const newScene = {
      ...scene,
      objects: [
        ...scene.objects.filter(o => !removeIds.has(o.id)),
        ...newObjects,
      ],
    };

    handleSceneCommit(newScene);
    setSelectedIds(new Set(newObjects.map(o => o.id)));
  }, [scene, selectedIds, handleSceneCommit, showAlert]);

  useEffect(() => {
    const onBoolean = (e: Event) => {
      const op = (e as CustomEvent<{ op: BooleanOp }>).detail?.op;
      if (op) void handleBooleanOp(op);
    };
    const onTextToPath = () => void handleTextToPath();
    window.addEventListener('laserforge:boolean', onBoolean as EventListener);
    window.addEventListener('laserforge:textToPath', onTextToPath);
    return () => {
      window.removeEventListener('laserforge:boolean', onBoolean as EventListener);
      window.removeEventListener('laserforge:textToPath', onTextToPath);
    };
  }, [handleBooleanOp, handleTextToPath]);

  const handleOffset = useCallback(async (distance: number) => {
    if (selectedIds.size === 0) return;

    const newObjects: typeof scene.objects = [];

    for (const obj of scene.objects) {
      if (!selectedIds.has(obj.id)) continue;

      const resultGeom = offsetObject(obj, distance);
      if (!resultGeom) continue;

      newObjects.push({
        id: generateId(),
        type: 'path',
        name: `${distance > 0 ? 'Outset' : 'Inset'} ${Math.abs(distance)}mm`,
        layerId: obj.layerId,
        parentId: null,
        transform: { ...IDENTITY_MATRIX },
        geometry: resultGeom,
        visible: true,
        locked: false,
        powerScale: obj.powerScale ?? 1,
        _bounds: null,
        _worldTransform: null,
      });
    }

    if (newObjects.length === 0) {
      await showAlert('Offset', 'Offset failed — shape may be too small or complex.');
      return;
    }

    handleSceneCommit({
      ...scene,
      objects: [...scene.objects, ...newObjects],
    });
  }, [scene, selectedIds, handleSceneCommit, showAlert]);

  const handleMaterialTestConfirm = useCallback((config: MaterialTestConfig) => {
    setShowMaterialTest(false);

    // Use existing engrave layer or create one
    let targetScene = scene;
    let layerId = scene.layers.find(l => l.settings.mode === 'engrave')?.id;
    if (!layerId) {
      const newLayer = createLayer(scene.layers.length, 'engrave', 'Material Test');
      targetScene = { ...scene, layers: [...scene.layers, newLayer] };
      layerId = newLayer.id;
    }

    const objects: typeof scene.objects = [];
    const startX = 10;
    const startY = 10;

    for (let r = 0; r < config.rows; r++) {
      for (let c = 0; c < config.cols; c++) {
        const x = startX + c * (config.cellSize + config.spacing);
        const y = startY + r * (config.cellSize + config.spacing);
        const power = config.rows === 1 ? config.powerMin :
          Math.round(config.powerMin + (r / (config.rows - 1)) * (config.powerMax - config.powerMin));
        const speed = config.cols === 1 ? config.speedMax :
          Math.round(config.speedMax - (c / (config.cols - 1)) * (config.speedMax - config.speedMin));

        // Filled rectangle
        objects.push({
          id: generateId(),
          type: 'rect' as any,
          name: `P${power} S${speed}`,
          layerId,
          parentId: null,
          transform: { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
          geometry: { type: 'rect', x: 0, y: 0, width: config.cellSize, height: config.cellSize } as any,
          visible: true, locked: false, powerScale: 1, _bounds: null, _worldTransform: null,
        });

        // Label below each cell
        objects.push({
          id: generateId(),
          type: 'text' as any,
          name: `Label`,
          layerId,
          parentId: null,
          transform: { a: 1, b: 0, c: 0, d: 1, tx: x + 0.5, ty: y + config.cellSize + 1 },
          geometry: {
            type: 'text',
            text: `${power}%/${speed}`,
            fontFamily: 'Arial',
            fontSize: Math.min(config.cellSize * 0.25, 2.5),
            bold: false, italic: false,
          } as any,
          visible: true, locked: false, powerScale: 1, _bounds: null, _worldTransform: null,
        });
      }
    }

    handleSceneCommit({ ...targetScene, objects: [...targetScene.objects, ...objects] });
  }, [scene, handleSceneCommit]);

  const handleMaterialConfirm = useCallback((config: MaterialConfig) => {
    setShowMaterialDialog(false);
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
    setShowMaterialDialog(false);
    handleSceneCommit({ ...scene, material: null });
  }, [scene, handleSceneCommit]);

  const handleTemplateSelect = useCallback(async (template: Template) => {
    setShowTemplates(false);
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
        onToggleShortcuts: () => setShowShortcuts(s => !s),
        onNudge: handleNudge,
        selectionCount: selectedIds.size,
        clipboardItemCount: clipboard.length,
        onBooleanUnion: () => void handleBooleanOp('union'),
        onBooleanSubtract: () => void handleBooleanOp('subtract'),
        onBooleanIntersect: () => void handleBooleanOp('intersect'),
        onAlignSelectionCenter: () => {
          if (selectedIds.size === 0) return;
          handleSceneCommit(alignSelection(scene, selectedIds, 'center'));
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
        handleBooleanOp,
        handleGridArray,
        compileGcode,
        scene,
        selectedIds,
        clipboard,
        handleSceneCommit,
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
      onSetup: () => setShowWizard(true),
      onMaterialTest: () => setShowMaterialTest(true),
      onMaterialSetup: () => setShowMaterialDialog(true),
      onTemplates: () => setShowTemplates(true),
      onBoxGenerator: () => setShowBoxGenerator(true),
      onPreviewToggle: () => setPreviewMode(p => !p),
      previewMode,
      onUndo: handleUndo,
      onRedo: handleRedo,
      canUndo: historyAvail.canUndo,
      canRedo: historyAvail.canRedo,
      projectName: scene.metadata?.name,
      materialName: scene.material?.name ?? null,
      onShowShortcuts: () => setShowShortcuts(true),
      productionMode,
      onToggleProductionMode: handleToggleProductionMode,
      onToolpathPreview: async () => {
        try {
          const gc = compileGcode(scene);
          if (gc) setGcodePreview(gc);
        } catch (err) {
          await showAlert('Preview Failed', 'Toolpath preview failed: ' + (err as Error).message);
        }
      },
    }),

    showRecover && !showWizard && React.createElement('div', {
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
      React.createElement(CanvasViewport, {
        scene,
        activeTool: activeTool,
        width: canvasSize.width - 240 - 36,
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
      }),
      React.createElement('div', {
        style: {
          width: 240,
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
            handleTextToPath: () => void handleTextToPath(),
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
      onConfirm: handleMaterialTestConfirm,
      onCancel: () => setShowMaterialTest(false),
    }),

    showVariableText && variableTextSource && React.createElement(VariableTextDialog, {
      scene,
      sourceObject: variableTextSource,
      onGenerate: handleVariableTextGenerate,
      onClose: () => { setShowVariableText(false); setVariableTextSource(null); },
    }),

    gcodePreview && React.createElement(GcodePreview, {
      gcode: gcodePreview,
      bedWidth: scene.canvas.width,
      bedHeight: scene.canvas.height,
      onClose: () => setGcodePreview(null),
    }),

    showMaterialDialog && React.createElement(MaterialDialog, {
      bedWidth: scene.canvas.width,
      bedHeight: scene.canvas.height,
      current: scene.material ? { type: scene.material.type, name: scene.material.name, width: scene.material.width, height: scene.material.height, thickness: scene.material.thickness } : null,
      onConfirm: handleMaterialConfirm,
      onClear: handleMaterialClear,
      onCancel: () => setShowMaterialDialog(false),
    }),

    showTemplates && React.createElement(TemplateBrowser, {
      onSelect: handleTemplateSelect,
      onClose: () => setShowTemplates(false),
    }),

    showBoxGenerator && React.createElement(BoxGenerator, {
      scene,
      onGenerate: handleBoxGenerate,
      onClose: () => setShowBoxGenerator(false),
    }),

    showWizard && React.createElement(WelcomeWizard, {
      onComplete: handleWizardComplete,
      onSkip: handleWizardSkip,
    }),

    showShortcuts && React.createElement(ShortcutsPanel, {
      onClose: () => setShowShortcuts(false),
    }),

    showConnection && grblReady && React.createElement(ConnectionPanel, {
      controller: grblControllerRef.current!,
      portRef: serialPortRef,
      machineState,
      jobProgress,
      scene,
      productionMode,
      gcode: currentGcode,
      onClose: () => setShowConnection(false),
      bedWidth: scene.canvas.width,
      bedHeight: scene.canvas.height,
      boundsMinX: Number.isFinite(sceneBounds.minX) ? sceneBounds.minX : 0,
      boundsMinY: Number.isFinite(sceneBounds.minY) ? sceneBounds.minY : 0,
      boundsMaxX: Number.isFinite(sceneBounds.maxX) ? sceneBounds.maxX : 100,
      boundsMaxY: Number.isFinite(sceneBounds.maxY) ? sceneBounds.maxY : 100,
      showAlert,
      showConfirm,
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
      handleTextToPath: () => void handleTextToPath(),
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

    showTextDialog && React.createElement('div', {
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 2000, fontFamily: "'DM Sans', system-ui, sans-serif",
      },
      onClick: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
          setShowTextDialog(false);
          setTextPlacementPt(null);
          setEditingTextId(null);
          setTextInput('');
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
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, editingTextId ? 'Edit Text' : 'Add Text'),
          React.createElement('button', {
            onClick: () => {
              setShowTextDialog(false);
              setTextPlacementPt(null);
              setEditingTextId(null);
              setTextInput('');
            },
            style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
          }, '×'),
        ),

        React.createElement('div', { style: { padding: '16px 18px' } },
          React.createElement('textarea', {
            value: textInput,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setTextInput(e.target.value),
            placeholder: 'Type your text here...',
            autoFocus: true,
            rows: 3,
            style: {
              width: '100%', padding: '10px 12px',
              background: '#0a0a14', border: '1px solid #252540', borderRadius: 8,
              color: '#e0e0ec', fontSize: 14, fontFamily: textFont,
              fontWeight: textBold ? 'bold' : 'normal',
              fontStyle: textItalic ? 'italic' : 'normal',
              outline: 'none', resize: 'vertical' as const,
            },
          }),
        ),

        React.createElement('div', { style: { padding: '0 18px 12px', display: 'flex', gap: 8 } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Font'),
            React.createElement('select', {
              value: textFont,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setTextFont(e.target.value),
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
              value: textSize,
              min: 3,
              max: 200,
              integer: true,
              inputMode: 'numeric',
              defaultValue: 20,
              onChange: (v: number) => setTextSize(v),
              onCommit: (v: number) => setTextSize(v),
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
            onClick: () => setTextBold(!textBold),
            style: {
              padding: '6px 16px', fontSize: 13, fontWeight: 700,
              background: textBold ? 'rgba(0,212,255,0.1)' : '#0a0a14',
              border: textBold ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 6, color: textBold ? '#00d4ff' : '#555570',
              cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
            },
          }, 'B'),
          React.createElement('button', {
            onClick: () => setTextItalic(!textItalic),
            style: {
              padding: '6px 16px', fontSize: 13, fontStyle: 'italic',
              background: textItalic ? 'rgba(0,212,255,0.1)' : '#0a0a14',
              border: textItalic ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 6, color: textItalic ? '#00d4ff' : '#555570',
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
              fontFamily: textFont, fontSize: Math.min(textSize * 2, 48),
              fontWeight: textBold ? 'bold' : 'normal',
              fontStyle: textItalic ? 'italic' : 'normal',
              color: '#e0e0ec',
            },
          }, textInput || 'Preview'),
        ),

        React.createElement('div', { style: { padding: '0 18px 16px' } },
          React.createElement('button', {
            onClick: () => {
              if (!textInput.trim()) return;

              if (editingTextId) {
                const newScene = {
                  ...scene,
                  objects: scene.objects.map(o =>
                    o.id === editingTextId
                      ? {
                          ...o,
                          name: textInput.length > 20 ? textInput.slice(0, 20) + '...' : textInput,
                          geometry: {
                            type: 'text' as const,
                            text: textInput,
                            fontSize: textSize,
                            fontFamily: textFont,
                            bold: textBold,
                            italic: textItalic,
                          },
                          _bounds: null,
                          _worldTransform: null,
                        }
                      : o
                  ),
                };
                handleSceneCommit(newScene);
                setEditingTextId(null);
              } else {
                const layerId = scene.activeLayerId || scene.layers[0]?.id;
                if (!layerId) return;

                const tx = textPlacementPt?.x ?? scene.canvas.width / 2 - 30;
                const ty = textPlacementPt?.y ?? scene.canvas.height / 2 - 10;

                const textObj: SceneObject = {
                  id: generateId(),
                  type: 'text',
                  name: textInput.length > 20 ? textInput.slice(0, 20) + '...' : textInput,
                  layerId,
                  parentId: null,
                  transform: { ...IDENTITY_MATRIX, tx, ty },
                  geometry: {
                    type: 'text',
                    text: textInput,
                    fontSize: textSize,
                    fontFamily: textFont,
                    bold: textBold,
                    italic: textItalic,
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

              setShowTextDialog(false);
              setTextInput('');
              setTextPlacementPt(null);
              setActiveTool('select');
            },
            disabled: !textInput.trim(),
            style: {
              width: '100%', padding: '10px',
              background: textInput.trim() ? 'rgba(45,212,160,0.1)' : '#1a1a2e',
              border: textInput.trim() ? '1px solid #2dd4a0' : '1px solid #252540',
              borderRadius: 8, color: textInput.trim() ? '#2dd4a0' : '#333355',
              fontSize: 13, fontWeight: 600, cursor: textInput.trim() ? 'pointer' : 'default',
              fontFamily: "'DM Sans', system-ui, sans-serif",
            },
          }, editingTextId ? 'Update Text' : 'Add Text to Canvas'),

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
