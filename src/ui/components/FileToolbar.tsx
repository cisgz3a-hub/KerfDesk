/**
 * === FILE: /src/ui/components/FileToolbar.tsx ===
 *
 * Purpose:    Toolbar with file operations: New, Import SVG, Save.
 *             Pure orchestration — delegates all logic to existing modules.
 *
 * Dependencies:
 *   - /src/core/scene/Scene.ts (createScene)
 *   - /src/import/svg/SvgToScene.ts (importSvgIntoScene)
 *   - /src/io/SceneSerializer.ts (serializeScene)
 *   - /src/io/FileIO.ts (saveSceneToFile)
 * Last updated: UI Wiring — File Toolbar
 */

import React, { useRef, useCallback } from 'react';
import { theme } from '../styles/theme';
import { type Scene, createScene } from '../../core/scene/Scene';
import { compileJob } from '../../core/job/JobCompiler';
import { optimizePlan } from '../../core/plan/PlanOptimizer';
import { getOutputStrategy } from '../../core/output/Output';
import '../../core/output/GrblStrategy';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { type SceneObject, type ImageGeometry } from '../../core/scene/SceneObject';
import { generateId } from '../../core/types';
import { saveSceneToFile } from '../../io/FileIO';
import { deserializeScene, serializeScene } from '../../io/SceneSerializer';
import { exportSceneToSvg } from '../../io/SvgExporter';

// ─── PROPS ───────────────────────────────────────────────────────

interface FileToolbarProps {
  scene: Scene;
  onSceneChange: (scene: Scene) => void;
  onSceneCommit: (scene: Scene) => void;
  /** Called when user clicks New — resets history instead of pushing. */
  onNewProject: (scene: Scene) => void;
  onConnect?: () => void;
  onSetup?: () => void;
  onMaterialTest?: () => void;
  onMaterialSetup?: () => void;
  onPreviewToggle?: () => void;
  previewMode?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  projectName?: string;
  onShowShortcuts?: () => void;
  onToolpathPreview?: () => void;
}

// ─── COMPONENT ───────────────────────────────────────────────────

export function FileToolbar({
  scene,
  onSceneChange,
  onSceneCommit,
  onNewProject,
  onConnect,
  onSetup,
  onMaterialTest,
  onMaterialSetup,
  onPreviewToggle,
  previewMode = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  projectName,
  onShowShortcuts,
  onToolpathPreview,
}: FileToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dxfInputRef = useRef<HTMLInputElement>(null);

  // ─── NEW PROJECT ─────────────────────────────────────────────

  const handleNew = useCallback(() => {
    if (scene.objects.length > 0) {
      if (!confirm('Start a new project? Unsaved changes will be lost.')) return;
    }
    try { localStorage.removeItem('laserforge_autosave'); } catch { /* ignore */ }
    const newScene = createScene(
      scene.canvas.width,
      scene.canvas.height,
      'Untitled'
    );
    onNewProject(newScene);
  }, [scene.canvas.width, scene.canvas.height, scene.objects.length, onNewProject]);

  // ─── IMPORT SVG ──────────────────────────────────────────────

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const svgString = await file.text();
      const layerId = scene.activeLayerId || scene.layers[0]?.id;
      if (!layerId) return;

      const updated = importSvgIntoScene(svgString, scene, layerId, {
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

      onSceneChange(updated);
      onSceneCommit(updated);
    } catch (e) {
      console.error('SVG import failed:', e);
      alert('Import failed: ' + (e as Error).message);
    }

    // Reset input so the same file can be re-imported
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [scene, onSceneChange, onSceneCommit]);

  const handleImportImageClick = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleImageSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      // Load image to get dimensions
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = dataUri;
      });

      // Convert pixel dimensions to mm (assume 96 DPI)
      const dpi = 96;
      const physicalWidth = (img.width / dpi) * 25.4;
      const physicalHeight = (img.height / dpi) * 25.4;

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

      // Scale to fit canvas if image is larger than bed (with 10% padding)
      const maxW = scene.canvas.width * 0.8;
      const maxH = scene.canvas.height * 0.8;
      let fitScale = 1;
      if (physicalWidth > maxW || physicalHeight > maxH) {
        fitScale = Math.min(maxW / physicalWidth, maxH / physicalHeight);
      }
      const finalWidth = physicalWidth * fitScale;
      const finalHeight = physicalHeight * fitScale;

      // Center on material if present, otherwise center on bed
      const centerX = scene.material
        ? scene.material.x + scene.material.width / 2
        : scene.canvas.width / 2;
      const centerY = scene.material
        ? scene.material.y + scene.material.height / 2
        : scene.canvas.height / 2;
      const cx = centerX - finalWidth / 2;
      const cy = centerY - finalHeight / 2;

      // Find or create an image layer
      let targetScene = scene;
      let layerId = scene.layers.find(l => l.settings.mode === 'image')?.id;
      if (!layerId) {
        const { createLayer } = await import('../../core/scene/Layer');
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

      const newScene = {
        ...targetScene,
        objects: [...targetScene.objects, imageObj],
      };
      onSceneChange(newScene);
      onSceneCommit(newScene);
    } catch (e) {
      console.error('Image import failed:', e);
      alert('Import failed: ' + (e as Error).message);
    }

    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }, [scene, onSceneChange, onSceneCommit]);

  const handleImportDxfClick = useCallback(() => {
    dxfInputRef.current?.click();
  }, []);

  const handleDxfSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const layerId = scene.activeLayerId || scene.layers[0]?.id;
      if (!layerId) return;

      const updated = importDxfIntoScene(text, scene, layerId);
      onSceneChange(updated);
      onSceneCommit(updated);
    } catch (e) {
      console.error('DXF import failed:', e);
      alert('Import failed: ' + (e as Error).message);
    }

    if (dxfInputRef.current) {
      dxfInputRef.current.value = '';
    }
  }, [scene, onSceneChange, onSceneCommit]);

  // ─── SAVE ────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    try {
      saveSceneToFile(scene);
      try {
        const serialized = serializeScene(scene);
        localStorage.setItem('laserforge_autosave', serialized);
        localStorage.setItem('laserforge_autosave_time', new Date().toISOString());
      } catch { /* ignore */ }
    } catch (e) {
      alert('Save failed: ' + (e as Error).message);
    }
  }, [scene]);

  const handleOpenClick = useCallback(() => {
    openInputRef.current?.click();
  }, []);

  const handleOpenFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const loaded = deserializeScene(text);
      onNewProject(loaded);
    } catch (e) {
      console.error('Failed to open file:', e);
      alert('Import failed: ' + (e as Error).message);
    }

    if (openInputRef.current) {
      openInputRef.current.value = '';
    }
  }, [onNewProject]);

  const handleGenerateGcode = useCallback(() => {
    try {
      const job = compileJob(scene);
      if (job.operations.length === 0) {
        alert('No objects to process. Add objects to an output layer first.');
        return;
      }
      const plan = optimizePlan(job);
      const strategy = getOutputStrategy('grbl');
      if (!strategy) return;
      const output = strategy.generate(plan, job);

      const blob = new Blob([output.text!], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (scene.metadata.name || 'untitled').replace(/\s+/g, '_') + '.gcode';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('G-code generation failed:', e);
      alert('G-code generation failed: ' + (e as Error).message);
    }
  }, [scene]);

  const handleExportSvg = useCallback(() => {
    try {
      const svg = exportSceneToSvg(scene);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (scene.metadata.name || 'Untitled') + '.svg';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed: ' + (e as Error).message);
    }
  }, [scene]);

  // ─── RENDER ──────────────────────────────────────────────────

  const btnStyle: React.CSSProperties = {
    padding: '5px 14px',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: theme.radius.sm,
    color: theme.text.secondary,
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.ui,
    cursor: 'pointer',
    transition: `all ${theme.transition.fast}`,
    fontWeight: 500,
  };

  const btnBase = btnStyle;

  const stdText = String(theme.text.secondary);

  const stdHover = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      const el = e.currentTarget;
      if (el.disabled) return;
      el.style.background = '#1a1a2e';
      el.style.borderColor = '#333355';
      el.style.color = '#e0e0ec';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      const el = e.currentTarget;
      if (el.disabled) return;
      el.style.background = 'transparent';
      el.style.borderColor = 'transparent';
      el.style.color = stdText;
    },
  };

  const undoRedoHover = (enabled: boolean) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!enabled) return;
      const el = e.currentTarget;
      el.style.background = '#1a1a2e';
      el.style.borderColor = '#333355';
      el.style.color = '#e0e0ec';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!enabled) return;
      const el = e.currentTarget;
      el.style.background = 'transparent';
      el.style.borderColor = 'transparent';
      el.style.color = stdText;
    },
  });

  const sep = React.createElement('div', { style: { width: 1, height: 20, background: '#252540', margin: '0 4px', flexShrink: 0 } });

  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '4px 8px',
      background: theme.bg.panel,
      borderBottom: `1px solid ${theme.border.subtle}`,
      fontFamily: theme.font.ui,
      flexWrap: 'nowrap' as const,
      overflow: 'hidden',
    },
  },
    React.createElement('span', {
      title: 'Project name',
      style: {
        color: '#555570',
        fontSize: 11,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontStyle: 'italic' as const,
        marginRight: 8,
        maxWidth: 120,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap' as const,
      },
    }, projectName || 'Untitled'),
    React.createElement('button', { onClick: handleNew, style: btnStyle, title: 'New project (clear canvas)', ...stdHover }, 'New'),
    React.createElement('button', { onClick: handleOpenClick, style: btnStyle, title: 'Open saved project', ...stdHover }, 'Open'),
    React.createElement('button', { onClick: handleSave, style: btnStyle, title: 'Save project (Ctrl+S)', ...stdHover }, 'Save'),
    React.createElement('button', {
      onClick: () => onUndo?.(),
      disabled: !canUndo,
      title: 'Undo (Ctrl+Z)',
      style: {
        ...btnBase,
        opacity: canUndo ? 1 : 0.3,
        cursor: canUndo ? 'pointer' : 'default',
        fontSize: 14,
        padding: '4px 8px',
      },
      ...undoRedoHover(!!canUndo),
    }, '↩'),
    React.createElement('button', {
      onClick: () => onRedo?.(),
      disabled: !canRedo,
      title: 'Redo (Ctrl+Y)',
      style: {
        ...btnBase,
        opacity: canRedo ? 1 : 0.3,
        cursor: canRedo ? 'pointer' : 'default',
        fontSize: 14,
        padding: '4px 8px',
      },
      ...undoRedoHover(!!canRedo),
    }, '↪'),
    sep,
    React.createElement('button', { onClick: handleImportClick, style: btnStyle, title: 'Import SVG vector file', ...stdHover }, 'SVG'),
    React.createElement('button', { onClick: handleImportImageClick, style: btnStyle, title: 'Import JPG/PNG image for tracing or engraving', ...stdHover }, 'Image'),
    React.createElement('button', { onClick: handleImportDxfClick, style: btnStyle, title: 'Import DXF CAD file', ...stdHover }, 'DXF'),
    sep,
    React.createElement('button', { onClick: handleGenerateGcode, style: btnStyle, title: 'Generate G-code for laser', ...stdHover }, 'G-code'),
    React.createElement('button', {
      onClick: () => onToolpathPreview?.(),
      style: btnStyle,
      title: 'Preview laser toolpath — see exactly how the laser will move (Ctrl+P)',
      ...stdHover,
    }, 'Toolpath'),
    React.createElement('button', { onClick: handleExportSvg, style: btnStyle, title: 'Export design as SVG file', ...stdHover }, 'Export'),
    sep,
    React.createElement('button', {
      onClick: () => onPreviewToggle?.(),
      title: 'Toggle burn preview — see how it will look on material',
      style: {
        padding: '5px 14px',
        background: previewMode ? 'rgba(45, 212, 160, 0.15)' : 'transparent',
        border: previewMode ? '1px solid #2dd4a0' : '1px solid transparent',
        borderRadius: 4,
        color: previewMode ? '#2dd4a0' : '#8888aa',
        fontSize: '11px',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        cursor: 'pointer',
        fontWeight: 600,
        transition: 'all 0.15s ease',
      },
      onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
        const el = e.currentTarget;
        if (previewMode) {
          el.style.background = 'rgba(45, 212, 160, 0.22)';
          el.style.borderColor = '#3de8b0';
          el.style.color = '#4dffc0';
        } else {
          el.style.background = '#1a1a2e';
          el.style.borderColor = '#333355';
          el.style.color = '#2dd4a0';
        }
      },
      onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
        const el = e.currentTarget;
        if (previewMode) {
          el.style.background = 'rgba(45, 212, 160, 0.15)';
          el.style.borderColor = '#2dd4a0';
          el.style.color = '#2dd4a0';
        } else {
          el.style.background = 'transparent';
          el.style.borderColor = 'transparent';
          el.style.color = '#8888aa';
        }
      },
    }, previewMode ? '● Preview' : '○ Preview'),
    React.createElement('button', { onClick: () => onConnect?.(), style: btnStyle, title: 'Connect to laser (GRBL)', ...stdHover }, 'Connect'),
    sep,
    React.createElement('button', { onClick: () => onSetup?.(), style: btnStyle, title: 'Change laser machine and workspace settings', ...stdHover }, 'Setup'),
    React.createElement('button', { onClick: () => onMaterialSetup?.(), style: btnStyle, title: 'Set material type and size', ...stdHover }, 'Material'),
    React.createElement('button', { onClick: () => onMaterialTest?.(), style: btnStyle, title: 'Generate power/speed test grid', ...stdHover }, 'Test'),

    React.createElement('div', { style: { flex: 1 } }),
    React.createElement('button', {
      onClick: () => onShowShortcuts?.(),
      title: 'Keyboard shortcuts (?)',
      style: {
        padding: '4px 10px',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 4,
        color: '#555570',
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: "'DM Sans', system-ui, sans-serif",
      },
      onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
        const el = e.currentTarget;
        el.style.background = '#1a1a2e';
        el.style.borderColor = '#333355';
        el.style.color = '#e0e0ec';
      },
      onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
        const el = e.currentTarget;
        el.style.background = 'transparent';
        el.style.borderColor = 'transparent';
        el.style.color = '#555570';
      },
    }, '?'),

    // Hidden file input for SVG import
    React.createElement('input', {
      ref: fileInputRef,
      type: 'file',
      accept: '.svg',
      style: { display: 'none' },
      onChange: handleFileSelected,
    }),
    React.createElement('input', {
      ref: openInputRef,
      type: 'file',
      accept: '.json,.laserforge.json',
      style: { display: 'none' },
      onChange: handleOpenFileSelected,
    }),
    React.createElement('input', {
      ref: imageInputRef,
      type: 'file',
      accept: 'image/png,image/jpeg,image/jpg,image/gif,image/webp',
      style: { display: 'none' },
      onChange: handleImageSelected,
    }),
    React.createElement('input', {
      ref: dxfInputRef,
      type: 'file',
      accept: '.dxf',
      style: { display: 'none' },
      onChange: handleDxfSelected,
    }),
  );
}
