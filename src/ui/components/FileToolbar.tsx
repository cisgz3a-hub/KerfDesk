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
import { type Scene, createScene } from '../../core/scene/Scene';
import '../../core/output/GrblStrategy';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { saveSceneToFile } from '../../io/FileIO';
import { deserializeScene, serializeScene } from '../../io/SceneSerializer';
// ─── PROPS ───────────────────────────────────────────────────────

interface FileToolbarProps {
  scene: Scene;
  /** Compile scene to G-code (shared with App — resets singleton strategy state). */
  compileGcode: (scene: Scene) => string | null;
  onSceneChange: (scene: Scene) => void;
  onSceneCommit: (scene: Scene) => void;
  /** Called when user clicks New — resets history instead of pushing. */
  onNewProject: (scene: Scene) => void;
  showAlert: (title: string, message: string, details?: string) => Promise<void>;
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>;
  onConnect?: () => void;
  onSetup?: () => void;
  onMaterialTest?: () => void;
  onMaterialSetup?: () => void;
  onMaterialLibrary?: () => void;
  onCamera?: () => void;
  /** Open start position / work origin wizard */
  onStartPosition?: () => void;
  /** Toolbar image import — shared pipeline with drag-drop (IndexedDB threshold, geometry). */
  onImportImageFile?: (file: File) => Promise<void>;
  onTemplates?: () => void;
  onBoxGenerator?: () => void;
  onAutoNest?: () => void;
  onKerfWizard?: () => void;
  onPreviewToggle?: () => void;
  previewMode?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  projectName?: string;
  /** Laser connection status for Connect button label. */
  isConnected?: boolean;
  /** Active material name from scene (toolbar display). */
  materialName?: string | null;
  onShowShortcuts?: () => void;
  onToolpathPreview?: () => void;
  productionMode?: boolean;
  onToggleProductionMode?: () => void;
}

// ─── COMPONENT ───────────────────────────────────────────────────

export function FileToolbar({
  scene,
  compileGcode,
  onSceneChange,
  onSceneCommit,
  onNewProject,
  showAlert,
  showConfirm,
  onConnect,
  onMaterialTest,
  onCamera,
  onStartPosition,
  onImportImageFile,
  onBoxGenerator,
  onAutoNest,
  onKerfWizard,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  projectName,
  isConnected = false,
  materialName,
  productionMode = false,
  onToggleProductionMode,
}: FileToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dxfInputRef = useRef<HTMLInputElement>(null);

  // ─── NEW PROJECT ─────────────────────────────────────────────

  const handleNew = useCallback(async () => {
    if (scene.objects.length > 0) {
      const ok = await showConfirm('New Project', 'Start a new project? Unsaved changes will be lost.');
      if (!ok) return;
    }
    try { localStorage.removeItem('laserforge_autosave'); } catch { /* ignore */ }
    const newScene = createScene(
      scene.canvas.width,
      scene.canvas.height,
      'Untitled'
    );
    onNewProject(newScene);
  }, [scene.canvas.width, scene.canvas.height, scene.objects.length, onNewProject, showConfirm]);

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
      await showAlert('Import Failed', 'Import failed: ' + (e as Error).message);
    }

    // Reset input so the same file can be re-imported
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [scene, onSceneChange, onSceneCommit, showAlert]);

  const handleImportImageClick = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleImageSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (onImportImageFile) {
        await onImportImageFile(file);
      }
    } catch (err) {
      console.error('Image import failed:', err);
      await showAlert('Import Failed', 'Import failed: ' + (err as Error).message);
    }

    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }, [onImportImageFile, showAlert]);

  const handleImportDxfClick = useCallback(() => {
    dxfInputRef.current?.click();
  }, []);

  const handleDxfSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();

      const updated = importDxfIntoScene(text, scene);
      onSceneChange(updated);
      onSceneCommit(updated);
    } catch (e) {
      console.error('DXF import failed:', e);
      await showAlert('Import Failed', 'Import failed: ' + (e as Error).message);
    }

    if (dxfInputRef.current) {
      dxfInputRef.current.value = '';
    }
  }, [scene, onSceneChange, onSceneCommit, showAlert]);

  // ─── SAVE ────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
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
      await showAlert('Import Failed', 'Import failed: ' + (e as Error).message);
    }

    if (openInputRef.current) {
      openInputRef.current.value = '';
    }
  }, [onNewProject, showAlert]);

  const handleGenerateGcode = useCallback(async () => {
    try {
      // Preflight: warn about text objects that won't be in output
      const textObjs = scene.objects.filter(o =>
        o.visible && (o.geometry as any).type === 'text' &&
        scene.layers.find(l => l.id === o.layerId)?.visible
      );
      if (textObjs.length > 0) {
        const names = textObjs.map(o => o.name || (o.geometry as any).text || 'Text').join(', ');
        const ok = await showConfirm(
          'Text Objects',
          `${textObjs.length} text object(s) will be skipped: ${names}\n\nConvert to paths first (right-click → "Text to Path").\n\nContinue?`
        );
        if (!ok) return;
      }
      const gc = compileGcode(scene);
      if (!gc) {
        await showAlert('No Objects', 'No objects to process. Add objects to an output layer first.');
        return;
      }

      const blob = new Blob([gc], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (scene.metadata.name || 'untitled').replace(/\s+/g, '_') + '.gcode';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('G-code generation failed:', e);
      await showAlert('G-code', 'G-code generation failed: ' + (e as Error).message);
    }
  }, [scene, compileGcode, showAlert, showConfirm]);

  // ─── RENDER ──────────────────────────────────────────────────

  const font = "'DM Sans', system-ui, sans-serif";
  const displayProjectName = projectName ?? scene.metadata?.name ?? 'Untitled';

  const toolbarBtn = (
    label: string,
    tooltip: string,
    onClick: (() => void) | undefined,
    options?: { active?: boolean; disabled?: boolean; color?: string; dimmed?: boolean },
  ) => {
    const { active = false, disabled = false, color, dimmed = false } = options || {};
    let opacity = 1;
    if (disabled) opacity = 0.5;
    else if (dimmed) opacity = 0.48;
    return React.createElement('button', {
      type: 'button',
      onClick: disabled ? undefined : onClick,
      title: tooltip,
      disabled,
      style: {
        padding: '3px 8px',
        fontSize: 11,
        background: active ? 'rgba(0,212,255,0.08)' : 'transparent',
        border: active ? '1px solid rgba(0,212,255,0.3)' : '1px solid transparent',
        borderRadius: 5,
        color: disabled ? '#333355' : (color || '#c0c0d0'),
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: font,
        whiteSpace: 'nowrap' as const,
        lineHeight: '20px',
        flexShrink: 0,
        opacity,
      },
    }, label);
  };

  const sep = () =>
    React.createElement('div', {
      style: { width: 1, height: 18, background: '#1a1a2e', flexShrink: 0, margin: '0 3px' },
    });

  const spacer = () => React.createElement('div', { style: { flex: 1, minWidth: 0 } });

  const easyDim = !productionMode;

  const row1 = React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        padding: '4px 10px',
        gap: 4,
        height: 34,
        overflow: 'visible',
        flexWrap: 'nowrap' as const,
        whiteSpace: 'nowrap' as const,
        minWidth: 0,
      },
    },
    toolbarBtn(
      productionMode ? '🟠 PRO' : '🟢 EASY',
      productionMode ? 'Switch to EASY mode' : 'Switch to PRO mode',
      () => onToggleProductionMode?.(),
      { color: productionMode ? '#ffaa32' : '#2dd4a0' },
    ),
    sep(),
    React.createElement('span', {
      style: {
        fontSize: 11,
        color: '#8888aa',
        maxWidth: 120,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap' as const,
        cursor: 'default',
        flexShrink: 1,
        minWidth: 0,
      },
      title: displayProjectName,
    }, displayProjectName),
    sep(),
    toolbarBtn('New', 'New project (Ctrl+N)', handleNew),
    toolbarBtn('Open', 'Open project (Ctrl+O)', handleOpenClick),
    toolbarBtn('Save', 'Save project (Ctrl+S)', handleSave),
    sep(),
    toolbarBtn('↩ Undo', 'Undo (Ctrl+Z)', () => onUndo?.(), { disabled: !canUndo }),
    toolbarBtn('↪ Redo', 'Redo (Ctrl+Y)', () => onRedo?.(), { disabled: !canRedo }),
    sep(),
    toolbarBtn('SVG', 'Import SVG file', handleImportClick),
    toolbarBtn('DXF', 'Import DXF file', handleImportDxfClick),
    toolbarBtn('Image', 'Import image (PNG, JPG)', handleImportImageClick),
    sep(),
    toolbarBtn('G-code', 'Export G-code for laser', () => { void handleGenerateGcode(); }, { color: '#2dd4a0' }),
    onConnect
      ? [
        spacer(),
        toolbarBtn(
          isConnected ? '⚡ Connected' : '⚡ Connect',
          isConnected ? 'Laser connected' : 'Connect to laser',
          () => onConnect(),
          { active: isConnected, color: isConnected ? '#2dd4a0' : '#c0c0d0' },
        ),
      ]
      : null,
  );

  const row2 = React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        padding: '3px 10px',
        gap: 4,
        height: 30,
        borderTop: '1px solid #12121e',
        overflow: 'visible',
        flexWrap: 'nowrap' as const,
        whiteSpace: 'nowrap' as const,
        minWidth: 0,
      },
    },
    toolbarBtn('📷 Camera', 'Camera alignment', () => onCamera?.(), { dimmed: easyDim }),
    toolbarBtn('🎯 Position', 'Start position wizard', () => onStartPosition?.(), { dimmed: easyDim }),
    toolbarBtn('⚄ Auto-Pack', 'Pack shapes to save material', () => onAutoNest?.(), { dimmed: easyDim }),
    toolbarBtn('⊞ Box', 'Finger-joint box generator', () => onBoxGenerator?.(), { dimmed: easyDim }),
    productionMode &&
      toolbarBtn('📐 Kerf', 'Kerf & fit wizard', () => onKerfWizard?.()),
    productionMode &&
      toolbarBtn('🧪 Test Grid', 'Material test grid', () => onMaterialTest?.()),
    spacer(),
    materialName
      ? React.createElement(
        'span',
        {
          style: {
            fontSize: 10,
            color: '#555570',
            padding: '2px 8px',
            background: 'rgba(0,212,255,0.03)',
            border: '1px solid #1a1a2e',
            borderRadius: 4,
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
            fontFamily: font,
            flexShrink: 0,
          },
          title: materialName,
        },
        `🪵 ${materialName}`,
      )
      : null,
  );

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column' as const,
        borderBottom: '1px solid #1a1a2e',
        background: '#0d0d18',
        flexShrink: 0,
        overflow: 'visible',
      },
    },
    row1,
    row2,
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
