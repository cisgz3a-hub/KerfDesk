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

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { type Scene, createScene } from '../../core/scene/Scene';
import '../../core/output/GrblStrategy';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { importDxfIntoScene } from '../../import/dxf';
import { saveSceneToFile } from '../../io/FileIO';
import { deserializeScene, serializeScene } from '../../io/SceneSerializer';
import { exportSceneToSvg } from '../../io/SvgExporter';

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
  onSetup,
  onMaterialTest,
  onMaterialSetup,
  onMaterialLibrary,
  onCamera,
  onStartPosition,
  onImportImageFile,
  onTemplates,
  onBoxGenerator,
  onAutoNest,
  onKerfWizard,
  onPreviewToggle,
  previewMode = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  projectName: _projectName,
  materialName,
  onShowShortcuts,
  onToolpathPreview,
  productionMode = false,
  onToggleProductionMode,
}: FileToolbarProps) {
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [nameDraft, setNameDraft] = useState(() => scene.metadata.name || 'Untitled');
  const toolsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setNameDraft(scene.metadata.name || 'Untitled');
  }, [scene.metadata.name, scene.id]);
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

  const handleExportSvg = useCallback(async () => {
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
      await showAlert('Export Failed', 'Export failed: ' + (e as Error).message);
    }
  }, [scene, showAlert]);

  const commitProjectName = useCallback(() => {
    const t = nameDraft.trim() || 'Untitled';
    const cur = scene.metadata.name || 'Untitled';
    if (t === cur) return;
    const next = { ...scene, metadata: { ...scene.metadata, name: t } };
    onSceneChange(next);
    onSceneCommit(next);
  }, [nameDraft, scene, onSceneChange, onSceneCommit]);

  // ─── RENDER ──────────────────────────────────────────────────

  const font = "'DM Sans', system-ui, sans-serif";

  const iconBtn = (
    label: string,
    title: string,
    onClick: (() => void) | undefined,
    opts?: { disabled?: boolean; color?: string; bg?: string; bold?: boolean },
  ) =>
    React.createElement('button', {
      type: 'button',
      onClick,
      title,
      disabled: opts?.disabled,
      style: {
        padding: '4px 6px',
        fontSize: 14,
        lineHeight: 1,
        cursor: opts?.disabled ? 'default' : 'pointer',
        background: opts?.bg || 'transparent',
        border: '1px solid transparent',
        borderRadius: 4,
        color: opts?.disabled ? '#333355' : (opts?.color || '#8888aa'),
        fontFamily: font,
        fontWeight: opts?.bold ? 600 : 400,
        whiteSpace: 'nowrap' as const,
        opacity: opts?.disabled ? 0.4 : 1,
        transition: 'background 0.1s',
        flexShrink: 0,
      },
      onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!opts?.disabled) (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
      },
      onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
        (e.target as HTMLElement).style.background = opts?.bg || 'transparent';
      },
    }, label);

  const sep = () =>
    React.createElement('div', {
      style: { width: 1, height: 18, background: '#1a1a2e', flexShrink: 0, margin: '0 2px' },
    });

  const toolMenuItems: Array<{ label: string; action?: () => void; show: boolean }> = [
    { label: '⊞ Material settings', action: onMaterialSetup, show: true },
    { label: '📷 Camera', action: onCamera, show: true },
    { label: '🎯 Position', action: onStartPosition, show: true },
    { label: '⚄ Auto-Pack', action: onAutoNest, show: true },
    { label: '⊞ Box Generator', action: onBoxGenerator, show: true },
    { label: '📐 Kerf Wizard', action: onKerfWizard, show: productionMode },
    { label: '🧪 Material Test', action: onMaterialTest, show: productionMode },
    { label: '✦ Templates', action: onTemplates, show: true },
    { label: '📚 Material Library', action: onMaterialLibrary, show: true },
    { label: 'Export SVG', action: () => { void handleExportSvg(); }, show: true },
    { label: '⎘ Toolpath', action: () => { void onToolpathPreview?.(); }, show: true },
    {
      label: previewMode ? '● Burn preview (on)' : '○ Burn preview (off)',
      action: onPreviewToggle,
      show: !!onPreviewToggle,
    },
    { label: 'DXF import', action: handleImportDxfClick, show: productionMode },
    { label: 'Setup', action: onSetup, show: true },
    { label: '? Shortcuts', action: onShowShortcuts, show: true },
  ];

  const buttonRect = showToolsMenu ? toolsButtonRef.current?.getBoundingClientRect() : undefined;
  const dropdownStyle = {
    position: 'fixed' as const,
    top: buttonRect ? buttonRect.bottom + 4 : 40,
    left: buttonRect ? buttonRect.left : 0,
    background: '#12121e',
    border: '1px solid #252540',
    borderRadius: 8,
    padding: '4px 0',
    zIndex: 3000,
    minWidth: 180,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  };

  const toolsMenu = React.createElement(
    'div',
    { style: { position: 'relative' as const, flexShrink: 0 } },
    showToolsMenu &&
      React.createElement('div', {
        style: { position: 'fixed' as const, inset: 0, zIndex: 2999, background: 'transparent' },
        onClick: () => setShowToolsMenu(false),
      }),
    React.createElement(
      'button',
      {
        ref: toolsButtonRef,
        type: 'button',
        onClick: () => setShowToolsMenu(v => !v),
        title: 'Tools menu',
        style: {
          padding: '4px 6px',
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
          background: showToolsMenu ? 'rgba(0,212,255,0.1)' : 'transparent',
          border: showToolsMenu ? '1px solid #00d4ff' : '1px solid transparent',
          borderRadius: 4,
          color: showToolsMenu ? '#00d4ff' : '#8888aa',
          fontFamily: font,
          whiteSpace: 'nowrap' as const,
          flexShrink: 0,
        },
      },
      '⚙▾',
    ),
    showToolsMenu &&
      React.createElement(
        'div',
        {
          style: dropdownStyle,
        },
        ...toolMenuItems
          .filter(item => item.show && item.action)
          .map(item =>
            React.createElement(
              'button',
              {
                key: item.label,
                type: 'button',
                onClick: () => {
                  item.action?.();
                  setShowToolsMenu(false);
                },
                style: {
                  display: 'block',
                  width: '100%',
                  padding: '7px 14px',
                  background: 'transparent',
                  border: 'none',
                  color: '#c0c0d0',
                  fontSize: 11,
                  cursor: 'pointer',
                  textAlign: 'left' as const,
                  fontFamily: font,
                  whiteSpace: 'nowrap' as const,
                },
                onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.background = 'rgba(0,212,255,0.06)';
                },
                onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.background = 'transparent';
                },
              },
              item.label,
            ),
          ),
      ),
  );

  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      height: 36,
      background: '#0d0d18',
      borderBottom: '1px solid #1a1a2e',
      padding: '4px 8px',
      gap: 2,
      fontFamily: font,
      flexShrink: 0,
      overflow: 'visible',
      flexWrap: 'nowrap' as const,
      whiteSpace: 'nowrap' as const,
      minWidth: 0,
    },
  },
    React.createElement('button', {
      type: 'button',
      onClick: () => onToggleProductionMode?.(),
      title: productionMode ? 'Switch to Beginner Mode' : 'Switch to Production Mode',
      style: {
        padding: '4px 6px',
        fontSize: 9,
        fontWeight: 700,
        cursor: 'pointer',
        background: productionMode ? 'rgba(255,170,50,0.15)' : 'rgba(45,212,160,0.15)',
        border: productionMode ? '1px solid rgba(255,170,50,0.3)' : '1px solid rgba(45,212,160,0.3)',
        borderRadius: 4,
        flexShrink: 0,
        fontFamily: font,
        color: productionMode ? '#ffaa32' : '#2dd4a0',
        lineHeight: 1,
      },
    }, productionMode ? 'PRO' : 'EASY'),

    sep(),

    React.createElement('input', {
      type: 'text',
      value: nameDraft,
      title: 'Project name — edit and press Enter or blur to apply',
      'aria-label': 'Project name',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNameDraft(e.target.value),
      onBlur: () => commitProjectName(),
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      },
      style: {
        color: '#a0a0b8',
        fontSize: 10,
        minWidth: 48,
        maxWidth: 120,
        flex: '1 1 80px',
        padding: '3px 6px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid #252540',
        borderRadius: 4,
        fontFamily: font,
        outline: 'none',
      },
    }),

    sep(),

    iconBtn('📄', 'New project (Ctrl+N)', handleNew),
    iconBtn('📂', 'Open project (Ctrl+O)', handleOpenClick),
    iconBtn('💾', 'Save project (Ctrl+S)', handleSave),

    sep(),

    iconBtn('↩', 'Undo (Ctrl+Z)', () => onUndo?.(), { disabled: !canUndo }),
    iconBtn('↪', 'Redo (Ctrl+Y)', () => onRedo?.(), { disabled: !canRedo }),

    sep(),

    iconBtn('📐', 'Import SVG file', handleImportClick),
    iconBtn('🖼', 'Import image (PNG/JPG)', handleImportImageClick),

    sep(),

    iconBtn('G', 'Export G-code file', handleGenerateGcode, { color: '#2dd4a0', bold: true }),

    sep(),

    toolsMenu,

    materialName ? sep() : null,
    materialName
      ? React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => onMaterialSetup?.(),
          title: materialName,
          style: {
            fontSize: 9,
            color: '#555570',
            maxWidth: 80,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontFamily: font,
            padding: '2px 4px',
          },
        },
        materialName,
      )
      : null,

    sep(),
    iconBtn('⚡', 'Connect to laser', () => onConnect?.(), { color: '#00d4ff', bold: true }),

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
