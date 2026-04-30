import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { generateId } from '../../../core/types';
import { type Scene } from '../../../core/scene/Scene';
import { type SceneObject } from '../../../core/scene/SceneObject';
import { generateBoxFaces, interiorToExterior } from '../../../core/box/boxGeometry';
import { BOX_LIBRARY_PRESETS, getBoxPresetById } from '../../../core/box/boxLibrary';
import type { BoxLibraryPreset } from '../../../core/box/boxLibraryTypes';
import { useBoxLibraryState } from '../../hooks/useBoxLibraryState';
import { usePersistentBoxPreferences } from '../../hooks/usePersistentBoxPreferences';
import { BoxLibraryPanel } from './BoxLibraryPanel';
import { BoxPresetDetail } from './BoxPresetDetail';
import { BoxGeneratorControls } from './BoxGeneratorControls';

type DimensionMode = 'outside' | 'inside';
const DEFAULT_PRESET_ID = 'small-keepsake-box';

interface BoxStudioWorkspaceProps {
  scene: Scene;
  onGenerate: (objects: SceneObject[]) => void;
  onRegisterCreate?: (handler: () => void) => void;
  onRegisterGenerateTestCoupon?: (handler: () => void) => void;
}

function validNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function BoxStudioWorkspace({
  scene,
  onGenerate,
  onRegisterCreate,
  onRegisterGenerateTestCoupon,
}: BoxStudioWorkspaceProps) {
  const { values: persistedPrefs, setValues: setPersistedPrefs } = usePersistentBoxPreferences();
  const initialPreset = getBoxPresetById(persistedPrefs.lastPresetId ?? '') ?? getBoxPresetById(DEFAULT_PRESET_ID) ?? BOX_LIBRARY_PRESETS[0]!;
  const library = useBoxLibraryState(initialPreset.id);
  const [width, setWidthRaw] = useState(initialPreset.width);
  const [height, setHeightRaw] = useState(initialPreset.height);
  const [depth, setDepthRaw] = useState(initialPreset.depth);
  const [thickness, setThicknessRaw] = useState(initialPreset.thickness);
  const [fingerWidth, setFingerWidthRaw] = useState(initialPreset.fingerWidth);
  const [kerf, setKerfRaw] = useState(() => validNumber(persistedPrefs.lastKerf, initialPreset.kerf));
  const [fitAllowance, setFitAllowanceRaw] = useState(() => validNumber(persistedPrefs.lastFitAllowance, initialPreset.fitAllowance));
  const [openTop, setOpenTopRaw] = useState(initialPreset.openTop);
  const [dimensionMode, setDimensionModeRaw] = useState<DimensionMode>('outside');
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null);
  const [customized, setCustomized] = useState(false);

  const selectedPreset = library.selectedPresetId ? getBoxPresetById(library.selectedPresetId) ?? null : null;
  const appliedPreset = appliedPresetId ? getBoxPresetById(appliedPresetId) ?? null : null;
  const markCustom = useCallback(() => {
    if (appliedPresetId) setCustomized(true);
  }, [appliedPresetId]);

  const setWidth = useCallback((v: number) => { setWidthRaw(v); markCustom(); }, [markCustom]);
  const setHeight = useCallback((v: number) => { setHeightRaw(v); markCustom(); }, [markCustom]);
  const setDepth = useCallback((v: number) => { setDepthRaw(v); markCustom(); }, [markCustom]);
  const setThickness = useCallback((v: number) => { setThicknessRaw(v); markCustom(); }, [markCustom]);
  const setFingerWidth = useCallback((v: number) => { setFingerWidthRaw(v); markCustom(); }, [markCustom]);
  const setKerf = useCallback((v: number) => { setKerfRaw(v); markCustom(); }, [markCustom]);
  const setFitAllowance = useCallback((v: number) => { setFitAllowanceRaw(v); markCustom(); }, [markCustom]);
  const setOpenTop = useCallback((v: boolean) => { setOpenTopRaw(v); markCustom(); }, [markCustom]);
  const setDimensionMode = useCallback((v: DimensionMode) => { setDimensionModeRaw(v); markCustom(); }, [markCustom]);

  useEffect(() => {
    setPersistedPrefs({
      lastPresetId: library.selectedPresetId ?? undefined,
      lastCategory: library.selectedCategory,
      lastSearch: library.searchQuery,
      lastKerf: kerf,
      lastFitAllowance: fitAllowance,
    });
  }, [library.selectedPresetId, library.selectedCategory, library.searchQuery, kerf, fitAllowance, setPersistedPrefs]);

  const resolved = dimensionMode === 'inside'
    ? interiorToExterior(width, height, depth, thickness, openTop)
    : { width, height, depth };
  const faces = useMemo(() => generateBoxFaces({
    width: resolved.width,
    height: resolved.height,
    depth: resolved.depth,
    thickness,
    fingerWidth,
    openTop,
    kerf,
    fitAllowance,
  }), [resolved.width, resolved.height, resolved.depth, thickness, fingerWidth, openTop, kerf, fitAllowance]);

  const applyPreset = useCallback((preset: BoxLibraryPreset): void => {
    library.setSelectedPresetId(preset.id);
    setAppliedPresetId(preset.id);
    setCustomized(false);
    setDimensionModeRaw('outside');
    setWidthRaw(preset.width);
    setHeightRaw(preset.height);
    setDepthRaw(preset.depth);
    setThicknessRaw(preset.thickness);
    setFingerWidthRaw(preset.fingerWidth);
    setKerfRaw(preset.kerf);
    setFitAllowanceRaw(preset.fitAllowance);
    setOpenTopRaw(preset.openTop);
  }, [library]);

  const generateCurrent = useCallback(() => {
    onGenerate(buildBoxObjects(scene, faces));
  }, [faces, onGenerate, scene]);

  const generateTestCoupon = useCallback(() => {
    const preset = getBoxPresetById('fit-test-mini-box') ?? BOX_LIBRARY_PRESETS[0]!;
    const couponFaces = generateBoxFaces({
      width: preset.width,
      height: preset.height,
      depth: preset.depth,
      thickness: preset.thickness,
      fingerWidth: preset.fingerWidth,
      openTop: preset.openTop,
      kerf: preset.kerf,
      fitAllowance: preset.fitAllowance,
    });
    onGenerate(buildBoxObjects(scene, couponFaces));
  }, [onGenerate, scene]);

  useEffect(() => {
    onRegisterCreate?.(generateCurrent);
    onRegisterGenerateTestCoupon?.(generateTestCoupon);
  }, [generateCurrent, generateTestCoupon, onRegisterCreate, onRegisterGenerateTestCoupon]);

  const sourceText = appliedPreset
    ? `${appliedPreset.name}${customized ? ' • Customized' : ''}`
    : 'Custom setup';

  return React.createElement('div', {
    className: 'box-studio-grid',
    style: {
      display: 'grid',
      gridTemplateColumns: '360px minmax(400px, 440px) minmax(420px, 1fr)',
      gap: 20,
      height: 'calc(100vh - 96px)',
      padding: '18px 22px 22px',
      minHeight: 0,
      overflow: 'hidden',
    },
  },
    React.createElement('style', null, `
      @media (max-width: 1220px) {
        .box-studio-grid { grid-template-columns: 340px minmax(520px, 1fr) !important; }
        .box-studio-detail { display: none !important; }
      }
      @media (max-width: 860px) {
        .box-studio-grid { display: flex !important; flex-direction: column !important; height: auto !important; overflow: auto !important; }
        .box-studio-panel { min-height: 520px !important; }
      }
    `),
    React.createElement('div', { className: 'box-studio-panel', style: panelStyle },
      React.createElement(BoxLibraryPanel, {
        presets: BOX_LIBRARY_PRESETS,
        selectedPresetId: library.selectedPresetId,
        selectedCategory: library.selectedCategory,
        searchQuery: library.searchQuery,
        onSearchChange: library.setSearchQuery,
        onCategoryChange: library.setSelectedCategory,
        onSelectPreset: library.setSelectedPresetId,
      }),
    ),
    React.createElement('div', { className: 'box-studio-detail box-studio-panel', style: panelStyle },
      React.createElement(BoxPresetDetail, { preset: selectedPreset, onApplyPreset: applyPreset }),
    ),
    React.createElement('div', { className: 'box-studio-panel', style: panelStyle },
      React.createElement(BoxGeneratorControls, {
        width,
        height,
        depth,
        thickness,
        fingerWidth,
        kerf,
        fitAllowance,
        openTop,
        dimensionMode,
        resolved,
        faces,
        sourceText,
        onWidthChange: setWidth,
        onHeightChange: setHeight,
        onDepthChange: setDepth,
        onThicknessChange: setThickness,
        onFingerWidthChange: setFingerWidth,
        onKerfChange: setKerf,
        onFitAllowanceChange: setFitAllowance,
        onOpenTopChange: setOpenTop,
        onDimensionModeChange: setDimensionMode,
        onGenerate: generateCurrent,
      }),
    ),
  );
}

function buildBoxObjects(scene: Scene, faces: ReturnType<typeof generateBoxFaces>): SceneObject[] {
  const layerId = scene.activeLayerId || scene.layers[0]?.id;
  if (!layerId) return [];
  return faces.map(face => ({
    id: generateId(),
    type: 'polygon' as const,
    name: `Box: ${face.name}`,
    layerId,
    parentId: null,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: face.offsetX + 20, ty: face.offsetY + 20 },
    geometry: { type: 'polygon' as const, points: face.points, closed: true },
    visible: true,
    locked: false,
    powerScale: 1.0,
    _bounds: null,
    _worldTransform: null,
  }));
}

const panelStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: '#12121e',
  border: '1px solid #252540',
  borderRadius: 16,
  boxShadow: '0 18px 44px rgba(0,0,0,0.24)',
};
