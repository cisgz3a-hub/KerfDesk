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
import { deserializeScene } from '../../io/SceneSerializer';
import { exportSceneToSvg } from '../../io/SvgExporter';

// ─── PROPS ───────────────────────────────────────────────────────

interface FileToolbarProps {
  scene: Scene;
  onSceneChange: (scene: Scene) => void;
  onSceneCommit: (scene: Scene) => void;
  /** Called when user clicks New — resets history instead of pushing. */
  onNewProject: (scene: Scene) => void;
  onSimulate?: () => void;
  onStopSimulation?: () => void;
  isSimulating?: boolean;
  onMaterialTest?: () => void;
  onMaterialSetup?: () => void;
}

// ─── COMPONENT ───────────────────────────────────────────────────

export function FileToolbar({
  scene,
  onSceneChange,
  onSceneCommit,
  onNewProject,
  onSimulate,
  onStopSimulation,
  isSimulating,
  onMaterialTest,
  onMaterialSetup,
}: FileToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dxfInputRef = useRef<HTMLInputElement>(null);

  // ─── NEW PROJECT ─────────────────────────────────────────────

  const handleNew = useCallback(() => {
    const newScene = createScene(
      scene.canvas.width,
      scene.canvas.height,
      'Untitled'
    );
    onNewProject(newScene);
  }, [scene.canvas.width, scene.canvas.height, onNewProject]);

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
    } catch (err) {
      console.error('SVG import failed:', err);
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
    } catch (err) {
      console.error('Image import failed:', err);
      alert('Image import failed: ' + (err as Error).message);
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
    } catch (err) {
      console.error('DXF import failed:', err);
      alert('DXF import failed: ' + (err as Error).message);
    }

    if (dxfInputRef.current) {
      dxfInputRef.current.value = '';
    }
  }, [scene, onSceneChange, onSceneCommit]);

  // ─── SAVE ────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    saveSceneToFile(scene);
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
    } catch (err) {
      console.error('Failed to open file:', err);
      alert('Failed to open file: ' + (err as Error).message);
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
    } catch (err) {
      console.error('G-code generation failed:', err);
      alert('G-code generation failed: ' + (err as Error).message);
    }
  }, [scene]);

  const handleExportSvg = useCallback(() => {
    const svg = exportSceneToSvg(scene);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (scene.metadata.name || 'Untitled') + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [scene]);

  const handleBedSize = useCallback(() => {
    const input = prompt(
      `Bed size (current: ${scene.canvas.width} × ${scene.canvas.height} mm)\nEnter: width,height`,
      `${scene.canvas.width},${scene.canvas.height}`
    );
    if (!input) return;
    const parts = input.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 2 || parts.some(isNaN) || parts.some(v => v < 10 || v > 2000)) {
      alert('Enter width,height in mm (10-2000)');
      return;
    }
    const newScene = {
      ...scene,
      canvas: { ...scene.canvas, width: parts[0], height: parts[1] },
    };
    onSceneCommit(newScene);
  }, [scene, onSceneCommit]);

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

  const sep = React.createElement('div', { style: { width: 1, height: 20, background: theme.border.default, margin: '0 6px' } });

  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '4px 8px',
      background: theme.bg.panel,
      borderBottom: `1px solid ${theme.border.subtle}`,
      fontFamily: theme.font.ui,
      flexWrap: 'wrap' as const,
    },
  },
    React.createElement('button', { onClick: handleNew, style: btnStyle }, 'New'),
    React.createElement('button', { onClick: handleOpenClick, style: btnStyle }, 'Open'),
    React.createElement('button', { onClick: handleSave, style: btnStyle }, 'Save'),
    sep,
    React.createElement('button', { onClick: handleImportClick, style: btnStyle }, 'Import SVG'),
    React.createElement('button', { onClick: handleImportImageClick, style: btnStyle }, 'Import Image'),
    React.createElement('button', { onClick: handleImportDxfClick, style: btnStyle }, 'Import DXF'),
    sep,
    React.createElement('button', { onClick: handleGenerateGcode, style: btnStyle }, 'G-code'),
    React.createElement('button', { onClick: handleExportSvg, style: btnStyle }, 'Export SVG'),
    !isSimulating && React.createElement('button', { onClick: onSimulate, style: btnStyle }, 'Simulate'),
    isSimulating && React.createElement('button', { onClick: onStopSimulation, style: { ...btnStyle, borderColor: '#e63e6d', color: '#e63e6d' } }, 'Stop Sim'),
    React.createElement('button', { onClick: handleBedSize, style: btnStyle }, 'Bed Size'),
    React.createElement('button', { onClick: () => onMaterialSetup?.(), style: btnStyle }, 'Material'),
    React.createElement('button', { onClick: () => onMaterialTest?.(), style: btnStyle }, 'Material Test'),

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
