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
import { simulatePlan, type SimulationResult } from '../../core/plan/Simulation';
import { deleteObjects, duplicateObjects } from '../../core/scene/SceneOps';
import { HistoryManager } from '../history/HistoryManager';
import { FileToolbar } from './FileToolbar';
import { CanvasViewport } from './CanvasViewport';
import { LayerPanel } from './LayerPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { ToolBar, type ToolType } from './ToolBar';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { deserializeScene } from '../../io/SceneSerializer';
import { generateId } from '../../core/types';
import { createLayer } from '../../core/scene/Layer';
import { type SceneObject, type ImageGeometry } from '../../core/scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';

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

  console.log('Direct bounds:', { wMinX, wMinY, wMaxX, wMaxY });
  console.log('Bed:', scn.canvas.width, 'x', scn.canvas.height);

  if (!isFinite(wMinX)) return scn;

  let dx = 0, dy = 0;

  switch (alignment) {
    case 'center':
      dx = scn.canvas.width / 2 - (wMinX + wMaxX) / 2;
      dy = scn.canvas.height / 2 - (wMinY + wMaxY) / 2;
      break;
    case 'left':   dx = -wMinX; break;
    case 'right':  dx = scn.canvas.width - wMaxX; break;
    case 'top':    dy = -wMinY; break;
    case 'bottom': dy = scn.canvas.height - wMaxY; break;
  }

  console.log('Offset dx:', dx, 'dy:', dy);

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
        const cx = scene.canvas.width / 2 - finalWidth / 2;
        const cy = scene.canvas.height / 2 - finalHeight / 2;

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
          const pasted = clipboard.map(obj => {
            const newId = generateId();
            newIds.add(newId);
            return {
              ...obj,
              id: newId,
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
          for (const obj of scene.objects) {
            if (!selectedIds.has(obj.id)) continue;
            const newId = generateId();
            newIds.add(newId);
            clones.push({
              ...obj,
              id: newId,
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
  }, [handleUndo, handleRedo, handleSelectAll, handleDelete, handleClearSelection, setActiveTool, scene, selectedIds, handleSceneCommit, clipboard]);

  // ─── RENDER ──────────────────────────────────────────────────

  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      height: '100vh',
      background: '#06060c',
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
        { label: 'Center on Bed    Ctrl+Shift+C', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'center'));
        }, disabled: selectedIds.size === 0 },
        { label: 'Align Left', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'left'));
        }, disabled: selectedIds.size === 0 },
        { label: 'Align Right', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'right'));
        }, disabled: selectedIds.size === 0 },
        { label: 'Align Top', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'top'));
        }, disabled: selectedIds.size === 0 },
        { label: 'Align Bottom', action: () => {
          handleSceneCommit(alignSelection(scene, selectedIds, 'bottom'));
        }, disabled: selectedIds.size === 0 },
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
  );
}
