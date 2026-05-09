/**
 * === FILE: /src/ui/components/FileToolbar.tsx ===
 *
 * Purpose:    Toolbar with file operations: New, Import SVG, Save.
 *             Pure orchestration — delegates all logic to existing modules.
 *
 * Dependencies:
 *   - /src/core/scene/Scene.ts (createScene)
 *   - /src/import/svg/SvgToScene.ts (importSvgIntoScene)
 *   - /src/io/SceneSerializer.ts (deserializeScene)
 *   - /src/io/FileIO.ts (saveSceneToFile)
 * Last updated: UI Wiring — File Toolbar
 */

import React, { useRef, useCallback, useState } from 'react';
import { type Scene, createScene } from '../../core/scene/Scene';
import '../../core/output/GrblStrategy';
import { formatSvgImportWarnings, importSvgIntoSceneWithReport } from '../../import/svg/SvgToScene';
import {
  chooseSvgUnitModeForImport,
  type SvgUnitChoiceOption,
} from '../../import/svg/SvgUnitChoice';
import { importDxfIntoScene } from '../../import/dxf';
import { assertDxfFileSize } from '../../import/dxf/DxfParser';
import { saveSceneToFile } from '../../io/FileIO';
import {
  confirmLargeProjectLoad,
  confirmLargeProjectSave,
  parseSceneFile,
} from '../../io/LargeProjectHandling';
import {
  formatMissingImageReferenceReport,
  validateAndAnnotateImageReferences,
} from '../../io/ImageReferenceValidation';
import { clearAutosave } from '../../app/autosavePersistence';
import { estimateSceneBytes } from '../history/estimateSceneBytes';
import { TestGridDialog } from './TestGridDialog';
import { BuildStamp } from './BuildStamp';
// ─── PROPS ───────────────────────────────────────────────────────

export interface FileToolbarProps {
  scene: Scene;
  /** Compile scene to G-code (shared with App — resets singleton strategy state). */
  compileGcode: (scene: Scene) => Promise<string | null>;
  onSceneChange: (scene: Scene) => void;
  onSceneCommit: (scene: Scene) => void;
  /** Called when user clicks New — resets history instead of pushing. */
  onNewProject: (scene: Scene, source: 'file' | 'autosave' | 'new') => void;
  showAlert: (title: string, message: string, details?: string) => Promise<void>;
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>;
  showChoice: (
    title: string,
    message: string,
    choices: readonly SvgUnitChoiceOption[],
    details?: string,
  ) => Promise<string | null>;
  onConnect?: () => void;
  /** Disconnect laser (toolbar); shown when connected. */
  onDisconnect?: () => void | Promise<void>;
  /** Close app (Electron quit or browser navigate away) */
  onExit?: () => void;
  onSetup?: () => void;
  onMaterialTest?: () => void;
  onCalibrateMaterial?: () => void;
  onMaterialSetup?: () => void;
  onMaterialLibrary?: () => void;
  onCamera?: () => void;
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
  /** Toggle compiled toolpath overlay on the design canvas. */
  onTogglePreview?: () => void;
  showToolpathPreview?: boolean;
  productionMode?: boolean;
  onToggleProductionMode?: () => void;
  /** After a successful disk save — sync auto-save snapshot / dirty flags in App. */
  onAfterSuccessfulFileSave?: () => void;
  /** From controller $30 / machine profile — test grid S clamp. */
  machineMaxSpindle?: number;
  machineBedWidth?: number;
  machineBedHeight?: number;
  onOpenSettings?: (tab?: 'machine' | 'gcode' | 'calibration' | 'profiles' | 'about') => void;
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
  showChoice,
  onConnect,
  onDisconnect,
  onExit,
  onMaterialTest,
  onCalibrateMaterial,
  onCamera,
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
  onTogglePreview,
  showToolpathPreview = false,
  onAfterSuccessfulFileSave,
  machineMaxSpindle = 1000,
  machineBedWidth = 300,
  machineBedHeight = 300,
  onOpenSettings,
}: FileToolbarProps) {
  const [testGridOpen, setTestGridOpen] = useState(false);
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
    clearAutosave();
    const newScene = createScene(
      scene.canvas.width,
      scene.canvas.height,
      'Untitled'
    );
    onNewProject(newScene, 'new');
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
      const svgUnitMode = await chooseSvgUnitModeForImport(svgString, showChoice);
      if (svgUnitMode === null) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const svgReport = importSvgIntoSceneWithReport(svgString, scene, layerId, {
        mode: 'fit',
        allowScaleUp: false,
        svgUnitMode,
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

      onSceneChange(svgReport.scene);
      onSceneCommit(svgReport.scene);
      const warningMessage = formatSvgImportWarnings(svgReport.warnings);
      if (warningMessage) {
        await showAlert('SVG Import Warning', warningMessage);
      }
    } catch (e) {
      console.error('SVG import failed:', e);
      await showAlert('Import Failed', 'Import failed: ' + (e as Error).message);
    }

    // Reset input so the same file can be re-imported
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [scene, onSceneChange, onSceneCommit, showAlert, showChoice]);

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
      assertDxfFileSize(file.size);
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
      const proceed = await confirmLargeProjectSave(estimateSceneBytes(scene), showConfirm);
      if (!proceed) return;
      await saveSceneToFile(scene);
    } catch (e) {
      await showAlert('Save Failed', 'Save failed: ' + (e as Error).message);
      return;
    }
    // T1-69: saveSceneToFile resolves on a.click() dispatch — not on actual
    // disk write. Browser-side download blockers, cancelled Save As dialogs,
    // disk-full and permission errors are all invisible to us. Until we have
    // a confirmed-write path (File System Access API / Electron fs), we ask
    // the user to verify before clearing the dirty flag.
    const ok = await showConfirm(
      'File saved?',
      'Make sure your browser saved the file. The app cannot confirm browser '
      + 'downloads.\n\nClick Yes if the file saved successfully. Click No if '
      + 'the download did not complete and you want to try again.',
    );
    if (ok) {
      onAfterSuccessfulFileSave?.();
    }
    // On No: dirty stays true; user can retry via Save again.
  }, [scene, showAlert, showConfirm, onAfterSuccessfulFileSave]);

  const handleOpenClick = useCallback(() => {
    openInputRef.current?.click();
  }, []);

  const handleOpenFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const proceed = await confirmLargeProjectLoad(file.size, showConfirm);
      if (!proceed) {
        if (openInputRef.current) openInputRef.current.value = '';
        return;
      }
      const loaded = await parseSceneFile(file);
      const { scene: annotated, validation } = await validateAndAnnotateImageReferences(loaded);
      onNewProject(annotated, 'file');
      const imageReport = formatMissingImageReferenceReport(validation);
      if (imageReport) {
        await showAlert('Missing Images', imageReport);
      }
    } catch (e) {
      console.error('Failed to open file:', e);
      await showAlert('Import Failed', 'Import failed: ' + (e as Error).message);
    }

    if (openInputRef.current) {
      openInputRef.current.value = '';
    }
  }, [onNewProject, showAlert, showConfirm]);

  const handleGenerateGcode = useCallback(async () => {
    try {
      const gc = await compileGcode(scene);
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
  }, [scene, compileGcode, showAlert]);

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
    toolbarBtn(
      'G-code Test',
      'Generate G-code power/speed calibration grid (download raw G-code)',
      () => setTestGridOpen(true),
    ),
    React.createElement('label', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 4,
        fontSize: 10,
        color: '#8888aa',
        cursor: 'pointer',
        userSelect: 'none' as const,
        flexShrink: 0,
      },
      title:
        'Automatically order operations: engrave first, then inner cuts, then outer cuts. Reduces travel time and prevents misalignment.',
    },
      React.createElement('input', {
        type: 'checkbox',
        checked: scene.compileOptions?.optimizeOrder !== false,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          onSceneCommit({
            ...scene,
            compileOptions: { ...scene.compileOptions, optimizeOrder: e.target.checked },
          });
        },
      }),
      React.createElement('span', null, 'Optimize order'),
    ),
    onTogglePreview
      ? React.createElement('button', {
        type: 'button',
        onClick: () => onTogglePreview(),
        title: 'Toggle toolpath preview overlay',
        style: {
          padding: '4px 10px',
          fontSize: 11,
          borderRadius: 5,
          cursor: 'pointer',
          fontFamily: font,
          whiteSpace: 'nowrap' as const,
          lineHeight: '20px',
          flexShrink: 0,
          background: showToolpathPreview ? 'rgba(0,140,255,0.15)' : 'transparent',
          border: showToolpathPreview ? '1px solid #008cff' : '1px solid transparent',
          color: showToolpathPreview ? '#008cff' : '#c0c0d0',
          fontWeight: showToolpathPreview ? 600 : 400,
        },
      }, showToolpathPreview ? '👁 Preview ON' : '👁 Preview')
      : null,
    spacer(),
    // T1-112 follow-up: build stamp inline in the toolbar, immediately
    // before Settings so the tester can read the deployed commit at a
    // glance without scrolling the canvas.
    React.createElement(BuildStamp),
    onOpenSettings
      ? toolbarBtn('⚙ Settings', 'Machine and application settings', () => onOpenSettings('machine'))
      : null,
    onConnect
      ? toolbarBtn(
        isConnected ? '⚡ Connected' : '⚡ Connect',
        isConnected ? 'Laser connected' : 'Connect to laser',
        () => onConnect(),
        { active: isConnected, color: isConnected ? '#2dd4a0' : '#c0c0d0' },
      )
      : null,
    onConnect && isConnected && onDisconnect
      ? toolbarBtn(
        'Disconnect',
        'Turn off laser and disconnect serial',
        () => { void onDisconnect(); },
        { color: '#ff6b6b' },
      )
      : null,
    onExit
      ? toolbarBtn('✕ Exit', 'Close LaserForge', () => onExit())
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
    toolbarBtn('⚄ Auto-Pack', 'Pack shapes to save material', () => onAutoNest?.(), { dimmed: easyDim }),
    toolbarBtn('⊞ Box Studio', 'Open the box generator and preset library', () => onBoxGenerator?.()),
    productionMode &&
      toolbarBtn('📐 Kerf', 'Kerf & fit wizard', () => onKerfWizard?.()),
    productionMode &&
      toolbarBtn('🧪 Material Test', 'Material test — add calibration squares to the scene', () => onMaterialTest?.()),
    toolbarBtn('🧫 Calibrate Material', 'Emit material response calibration grid and capture photo ROI', () => onCalibrateMaterial?.()),
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
    React.createElement(TestGridDialog, {
      open: testGridOpen,
      onClose: () => setTestGridOpen(false),
      onGenerate: (gcode: string, _bounds: { width: number; height: number }) => {
        const blob = new Blob([gcode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `test-grid-${new Date().toISOString().slice(0, 10)}.gcode`;
        a.click();
        URL.revokeObjectURL(url);
      },
      defaultMaxSpindle: machineMaxSpindle,
      defaultBedWidth: machineBedWidth,
      defaultBedHeight: machineBedHeight,
    }),
  );
}
