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

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { type Scene, createScene } from '../../core/scene/Scene';
import { compileJob } from '../../core/job/JobCompiler';
import { optimizePlan } from '../../core/plan/PlanOptimizer';
import { getOutputStrategy } from '../../core/output/Output';
import '../../core/output/GrblStrategy';
import { simulatePlan, type SimulationResult } from '../../core/plan/Simulation';
import { deleteObjects, duplicateObjects } from '../../core/scene/SceneOps';
import { HistoryManager } from '../history/HistoryManager';
import { FileToolbar } from './FileToolbar';
import { CanvasViewport } from './CanvasViewport';
import { LayerPanel } from './LayerPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { ToolBar, type ToolType } from './ToolBar';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { GridArrayDialog, type GridArrayConfig } from './GridArrayDialog';
import { MaterialTestDialog, type MaterialTestConfig } from './MaterialTestDialog';
import { GcodePreview } from './GcodePreview';
import { MaterialDialog, type MaterialConfig } from './MaterialDialog';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { deserializeScene } from '../../io/SceneSerializer';
import { generateId } from '../../core/types';
import { createLayer } from '../../core/scene/Layer';
import { type SceneObject, type ImageGeometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';
import { theme } from '../styles/theme';
import { WelcomeWizard, type WizardResult } from './WelcomeWizard';

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
  const [zoomLevel, setZoomLevel] = useState(100);
  const viewportActionsRef = useRef<{ zoomIn: () => void; zoomOut: () => void; fitToBed: () => void } | null>(null);

  const [scene, setScene] = useState<Scene>(() => {
    const initial = createScene(400, 300, 'Untitled');
    return initial;
  });
  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight - 34 });
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [clipboard, setClipboard] = useState<typeof scene.objects>([]);
  const [showGridArray, setShowGridArray] = useState(false);
  const [gridArrayBounds, setGridArrayBounds] = useState({ w: 0, h: 0 });
  const [showMaterialTest, setShowMaterialTest] = useState(false);
  const [showMaterialDialog, setShowMaterialDialog] = useState(false);
  const [gcodePreview, setGcodePreview] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [showWizard, setShowWizard] = useState(() => {
    try {
      return !localStorage.getItem('laserforge_setup_complete');
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const onResize = () => setCanvasSize({ width: window.innerWidth, height: window.innerHeight - 34 });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const historyRef = useRef<HistoryManager>(new HistoryManager());

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
    historyRef.current.push(newScene);
    setScene(newScene);
  }, []);

  /** New project: reset history entirely and start fresh. */
  const handleNewProject = useCallback((newScene: Scene) => {
    historyRef.current.reset(newScene);
    setScene(newScene);
  }, []);

  const handleWizardComplete = useCallback((result: WizardResult) => {
    setShowWizard(false);
    try { localStorage.setItem('laserforge_setup_complete', 'true'); } catch { /* ignore */ }

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
    };
    handleSceneCommit(newScene);

    // Fit to bed after a tick
    setTimeout(() => viewportActionsRef.current?.fitToBed(), 100);
  }, [scene, handleSceneCommit]);

  const handleWizardSkip = useCallback(() => {
    setShowWizard(false);
    try { localStorage.setItem('laserforge_setup_complete', 'true'); } catch { /* ignore */ }
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

  const handleDuplicate = useCallback(() => {
    if (selectedIds.size === 0) return;
    const newScene = duplicateObjects(scene, selectedIds, 10, 10);
    historyRef.current.push(newScene);
    setScene(newScene);
    setSelectedIds(new Set(newScene.selection));
  }, [scene, selectedIds]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    const text = name.endsWith('.svg') || name.endsWith('.dxf') || name.endsWith('.json')
      ? await file.text()
      : null;

    try {
      if (name.endsWith('.laserforge.json') || (name.endsWith('.json') && text)) {
        // Open project file
        const loaded = deserializeScene(text!);
        handleNewProject(loaded);
      } else if (name.endsWith('.svg') && text) {
        // Import SVG
        const layerId = scene.activeLayerId || scene.layers[0]?.id;
        if (!layerId) return;
        const updated = importSvgIntoScene(text, scene, layerId, {
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
        handleSceneCommit(updated);
      } else if (name.endsWith('.dxf') && text) {
        // Import DXF
        const layerId = scene.activeLayerId || scene.layers[0]?.id;
        if (!layerId) return;
        const updated = importDxfIntoScene(text, scene, layerId);
        handleSceneCommit(updated);
      } else if (file.type.startsWith('image/')) {
        // Import image
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to decode image'));
          img.src = dataUri;
        });

        const dpi = 96;
        const physicalWidth = (img.width / dpi) * 25.4;
        const physicalHeight = (img.height / dpi) * 25.4;

        const maxW = scene.canvas.width * 0.8;
        const maxH = scene.canvas.height * 0.8;
        let fitScale = 1;
        if (physicalWidth > maxW || physicalHeight > maxH) {
          fitScale = Math.min(maxW / physicalWidth, maxH / physicalHeight);
        }
        const finalWidth = physicalWidth * fitScale;
        const finalHeight = physicalHeight * fitScale;
        const centerX = scene.material
          ? scene.material.x + scene.material.width / 2
          : scene.canvas.width / 2;
        const centerY = scene.material
          ? scene.material.y + scene.material.height / 2
          : scene.canvas.height / 2;
        const cx = centerX - finalWidth / 2;
        const cy = centerY - finalHeight / 2;

        // Grayscale conversion
        const maxDim = 1000;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const gsWidth = Math.round(img.width * scale);
        const gsHeight = Math.round(img.height * scale);
        const offscreen = document.createElement('canvas');
        offscreen.width = gsWidth;
        offscreen.height = gsHeight;
        const offCtx = offscreen.getContext('2d')!;
        offCtx.drawImage(img, 0, 0, gsWidth, gsHeight);
        const imageData = offCtx.getImageData(0, 0, gsWidth, gsHeight);
        const grayscaleData = new Uint8Array(gsWidth * gsHeight);
        for (let i = 0; i < grayscaleData.length; i++) {
          const r = imageData.data[i * 4];
          const g = imageData.data[i * 4 + 1];
          const b = imageData.data[i * 4 + 2];
          const a = imageData.data[i * 4 + 3];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          grayscaleData[i] = Math.round(lum * (a / 255) + 255 * (1 - a / 255));
        }

        // Find or create image layer
        let targetScene = scene;
        let layerId = scene.layers.find(l => l.settings.mode === 'image')?.id;
        if (!layerId) {
          const newLayer = createLayer(scene.layers.length, 'image', 'Image');
          targetScene = {
            ...scene,
            layers: [...scene.layers, newLayer],
            activeLayerId: newLayer.id,
          };
          layerId = newLayer.id;
        }

        const imageObj: SceneObject = {
          id: generateId(),
          type: 'image',
          name: file.name.replace(/\.[^.]+$/, ''),
          layerId,
          parentId: null,
          transform: { a: fitScale, b: 0, c: 0, d: fitScale, tx: cx, ty: cy },
          geometry: {
            type: 'image',
            src: dataUri,
            originalWidth: img.width,
            originalHeight: img.height,
            cropX: 0,
            cropY: 0,
            cropWidth: img.width,
            cropHeight: img.height,
            grayscaleData,
            grayscaleWidth: gsWidth,
            grayscaleHeight: gsHeight,
          } as ImageGeometry,
          visible: true,
          locked: false,
          _bounds: null,
          _worldTransform: null,
        };

        handleSceneCommit({
          ...targetScene,
          objects: [...targetScene.objects, imageObj],
        });
      }
    } catch (err) {
      console.error('Drop import failed:', err);
    }
  }, [scene, handleSceneCommit, handleNewProject]);

  const handleSimulate = useCallback(() => {
    try {
      const job = compileJob(scene);
      if (job.operations.length === 0) {
        setSimulation(null);
        return;
      }
      const plan = optimizePlan(job);
      const result = simulatePlan(plan);
      setSimulation(result);
    } catch (err) {
      console.error('Simulation failed:', err);
      setSimulation(null);
    }
  }, [scene]);

  const handleStopSimulation = useCallback(() => {
    setSimulation(null);
  }, []);

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
          visible: true, locked: false, _bounds: null, _worldTransform: null,
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
          visible: true, locked: false, _bounds: null, _worldTransform: null,
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

  // ─── KEYBOARD SHORTCUTS ──────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;

      // Modifier shortcuts
      if (isMod) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
        } else if (e.key === 'a') {
          e.preventDefault();
          handleSelectAll();
        } else if (e.key === 'c' && e.ctrlKey && selectedIds.size > 0) {
          e.preventDefault();
          setClipboard(scene.objects.filter(o => selectedIds.has(o.id)));
          return;
        } else if (e.key === 'v' && e.ctrlKey && clipboard.length > 0) {
          e.preventDefault();
          const newIds = new Set<string>();
          const parentIdMap = new Map<string, string>();

          const pasted = clipboard.map(obj => {
            const newId = generateId();
            newIds.add(newId);

            let newParentId = obj.parentId;
            if (obj.parentId) {
              if (!parentIdMap.has(obj.parentId)) {
                parentIdMap.set(obj.parentId, generateId());
              }
              newParentId = parentIdMap.get(obj.parentId)!;
            }

            return {
              ...obj,
              id: newId,
              parentId: newParentId,
              name: obj.name,
              transform: { ...obj.transform, tx: obj.transform.tx + 10, ty: obj.transform.ty + 10 },
              _bounds: null,
              _worldTransform: null,
            };
          });
          const newScene = { ...scene, objects: [...scene.objects, ...pasted] };
          handleSceneCommit(newScene);
          setSelectedIds(newIds);
          setClipboard(pasted);
          return;
        } else if (e.key === 'd' && e.ctrlKey && selectedIds.size > 0) {
          e.preventDefault();
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
          return;
        }
        if (e.key === 'C' && e.ctrlKey && e.shiftKey && selectedIds.size > 0) {
          e.preventDefault();
          handleSceneCommit(alignSelection(scene, selectedIds, 'center'));
          return;
        }
        // Grid array: Ctrl+Shift+A
        if (e.key === 'A' && e.ctrlKey && e.shiftKey && selectedIds.size > 0) {
          e.preventDefault();
          handleGridArray();
          return;
        }
        // Preview G-code: Ctrl+P
        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          try {
            const job = compileJob(scene);
            if (job.operations.length === 0) return;
            const plan = optimizePlan(job);
            const strategy = getOutputStrategy('grbl');
            if (!strategy) return;
            const output = strategy.generate(plan, job);
            setGcodePreview(output.text ?? '');
          } catch (err) {
            console.error('G-code generation failed:', err);
          }
          return;
        }
        return;
      }

      // Non-modifier shortcuts
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDelete();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedIds.size > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;

        const newScene = {
          ...scene,
          objects: scene.objects.map(o => {
            if (!selectedIds.has(o.id)) return o;
            return {
              ...o,
              transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy },
              _bounds: null, _worldTransform: null,
            };
          }),
        };
        handleSceneCommit(newScene);
        return;
      } else if (e.key === 'Escape') {
        handleClearSelection();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setActiveTool('text');
        return;
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setActiveTool('node');
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo, handleSelectAll, handleDelete, handleClearSelection, setActiveTool, scene, selectedIds, handleSceneCommit, clipboard, handleGridArray]);

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
      onSceneChange: handleSceneChange,
      onSceneCommit: handleSceneCommit,
      onNewProject: handleNewProject,
      onSimulate: handleSimulate,
      onStopSimulation: handleStopSimulation,
      isSimulating: simulation !== null,
      onMaterialTest: () => setShowMaterialTest(true),
      onMaterialSetup: () => setShowMaterialDialog(true),
      onPreviewToggle: () => setPreviewMode(p => !p),
      previewMode,
    }),

    React.createElement('div', {
      style: { flex: 1, overflow: 'hidden', display: 'flex' },
    },
      React.createElement(ToolBar, {
        activeTool,
        onToolChange: setActiveTool,
      }),
      React.createElement(CanvasViewport, {
        scene,
        simulation,
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
            onSelectionChange: setSelectedIds,
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
      React.createElement('span', {}, scene.metadata.name || 'Untitled'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
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
      onClose: () => setContextMenu(null),
      items: [
        { label: 'Select All          Ctrl+A', action: handleSelectAll },
        { label: 'separator', action: () => {}, separator: true },
        { label: 'Duplicate           Ctrl+D', action: handleDuplicate, disabled: selectedIds.size === 0 },
        { label: 'Delete              Del', action: handleDelete, disabled: selectedIds.size === 0 },
        { label: 'separator', action: () => {}, separator: true },
        { label: `${scene.material ? 'Center on Material' : 'Center on Bed'}    Ctrl+Shift+C`, action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'center'));
        }, disabled: selectedIds.size === 0 },
        { label: scene.material?.enabled ? 'Align to Material Left' : 'Align Left', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'left'));
        }, disabled: selectedIds.size === 0 },
        { label: scene.material?.enabled ? 'Align to Material Right' : 'Align Right', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'right'));
        }, disabled: selectedIds.size === 0 },
        { label: scene.material?.enabled ? 'Align to Material Top' : 'Align Top', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'top'));
        }, disabled: selectedIds.size === 0 },
        { label: scene.material?.enabled ? 'Align to Material Bottom' : 'Align Bottom', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'bottom'));
        }, disabled: selectedIds.size === 0 },
        { label: 'separator', action: () => {}, separator: true },
        { label: '⌂ Home: top-left of material', action: () => {
          const mat = scene.material?.enabled ? scene.material : null;
          const x = mat ? mat.x : 0;
          const y = mat ? mat.y : 0;
          handleSceneCommit({ ...scene, startPosition: { x, y } });
        }, disabled: false },
        { label: '⌂ Home: center of material', action: () => {
          const mat = scene.material?.enabled ? scene.material : null;
          const x = mat ? mat.x + mat.width / 2 : scene.canvas.width / 2;
          const y = mat ? mat.y + mat.height / 2 : scene.canvas.height / 2;
          handleSceneCommit({ ...scene, startPosition: { x, y } });
        }, disabled: false },
        { label: '⌂ Home: machine origin (0,0)', action: () => {
          handleSceneCommit({ ...scene, startPosition: { x: 0, y: 0 } });
        }, disabled: false },
        { label: 'Grid Array...', action: handleGridArray, disabled: selectedIds.size === 0 },
        { label: 'Material Test...', action: () => setShowMaterialTest(true), disabled: false },
        ...scene.layers.map(l => ({
          label: `Move to: ${l.name}`,
          disabled: selectedIds.size === 0,
          action: () => {
            const newScene = {
              ...scene,
              objects: scene.objects.map(o =>
                selectedIds.has(o.id) ? { ...o, layerId: l.id } : o
              ),
            };
            handleSceneCommit(newScene);
          },
        })),
      ] as MenuItem[],
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

    showWizard && React.createElement(WelcomeWizard, {
      onComplete: handleWizardComplete,
      onSkip: handleWizardSkip,
    }),
  );
}
