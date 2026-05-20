import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { generateId } from '../../../core/types';
import { type Scene } from '../../../core/scene/Scene';
import { type SceneObject } from '../../../core/scene/SceneObject';
import { interiorToExterior } from '../../../core/box/boxGeometry';
import { generateBoxFacesV2, validateBoxGenerationParams, type BoxJoineryParams } from '../../../core/box/boxGeometryV2';
import { BOX_LIBRARY_PRESETS, getBoxPresetById } from '../../../core/box/boxLibrary';
import type { BoxLibraryPreset } from '../../../core/box/boxLibraryTypes';
import { useBoxLibraryState } from '../../hooks/useBoxLibraryState';
import { usePersistentBoxPreferences } from '../../hooks/usePersistentBoxPreferences';
import { BoxLibraryPanel } from './BoxLibraryPanel';
import { BoxPresetDetail } from './BoxPresetDetail';
import { BoxGeneratorControls } from './BoxGeneratorControls';

type DimensionMode = 'outside' | 'inside';
const DEFAULT_PRESET_ID = 'small-keepsake-box';

interface BoxFeatureSource {
  preset: BoxLibraryPreset;
  width: number;
  height: number;
  depth: number;
  thickness: number;
  openTop: boolean;
}

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
  const [tabExtraDepth, setTabExtraDepthRaw] = useState(0.2);
  const [slotExtraDepth, setSlotExtraDepthRaw] = useState(0.35);
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
  const setTabExtraDepth = useCallback((v: number) => { setTabExtraDepthRaw(v); markCustom(); }, [markCustom]);
  const setSlotExtraDepth = useCallback((v: number) => { setSlotExtraDepthRaw(v); markCustom(); }, [markCustom]);
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
  const boxParams = useMemo<BoxJoineryParams>(() => ({
    width: resolved.width,
    height: resolved.height,
    depth: resolved.depth,
    thickness,
    fingerWidth,
    openTop,
    kerf,
    fitAllowance,
    tabExtraDepth,
    slotExtraDepth,
    cornerRelief: 'none',
  }), [resolved.width, resolved.height, resolved.depth, thickness, fingerWidth, openTop, kerf, fitAllowance, tabExtraDepth, slotExtraDepth]);
  const boxValidation = useMemo(() => validateBoxGenerationParams(boxParams), [boxParams]);
  const faces = useMemo(
    () => (boxValidation.ok ? generateBoxFacesV2(boxParams) : []),
    [boxParams, boxValidation.ok],
  );

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
    setTabExtraDepthRaw(0.2);
    setSlotExtraDepthRaw(0.35);
    setOpenTopRaw(preset.openTop);
  }, [library]);

  const generateCurrent = useCallback(() => {
    if (!boxValidation.ok) return;
    const featureSource: BoxFeatureSource | null = appliedPreset
      ? {
          preset: appliedPreset,
          width: resolved.width,
          height: resolved.height,
          depth: resolved.depth,
          thickness,
          openTop,
        }
      : null;
    onGenerate(buildBoxObjects(scene, faces, featureSource));
  }, [appliedPreset, boxValidation.ok, faces, onGenerate, openTop, resolved.depth, resolved.height, resolved.width, scene, thickness]);

  const generateTestCoupon = useCallback(() => {
    const preset = getBoxPresetById('fit-test-mini-box') ?? BOX_LIBRARY_PRESETS[0]!;
    const couponFaces = generateBoxFacesV2({
      width: preset.width,
      height: preset.height,
      depth: preset.depth,
      thickness: preset.thickness,
      fingerWidth: preset.fingerWidth,
      openTop: preset.openTop,
      kerf: preset.kerf,
      fitAllowance: preset.fitAllowance,
      tabExtraDepth: 0.2,
      slotExtraDepth: 0.35,
      cornerRelief: 'none',
    });
    onGenerate(buildBoxObjects(scene, couponFaces, null));
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
        tabExtraDepth,
        slotExtraDepth,
        openTop,
        dimensionMode,
        resolved,
        faces,
        validationErrors: boxValidation.errors,
        sourceText,
        onWidthChange: setWidth,
        onHeightChange: setHeight,
        onDepthChange: setDepth,
        onThicknessChange: setThickness,
        onFingerWidthChange: setFingerWidth,
        onKerfChange: setKerf,
        onFitAllowanceChange: setFitAllowance,
        onTabExtraDepthChange: setTabExtraDepth,
        onSlotExtraDepthChange: setSlotExtraDepth,
        onOpenTopChange: setOpenTop,
        onDimensionModeChange: setDimensionMode,
        onGenerate: generateCurrent,
      }),
    ),
  );
}

function buildBoxObjects(
  scene: Scene,
  faces: ReturnType<typeof generateBoxFacesV2>,
  featureSource: BoxFeatureSource | null,
): SceneObject[] {
  const layerId = scene.activeLayerId || scene.layers[0]?.id;
  if (!layerId) return [];
  const faceObjects = faces.map(face => ({
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
  const featureObjects = featureSource
    ? buildPresetFeatureObjects(layerId, faces, featureSource)
    : [];
  return [...faceObjects, ...featureObjects];
}

type BoxFace = ReturnType<typeof generateBoxFacesV2>[number];

function buildPresetFeatureObjects(
  layerId: string,
  faces: readonly BoxFace[],
  source: BoxFeatureSource,
): SceneObject[] {
  const objects: SceneObject[] = [];
  const front = faces.find(face => face.name === 'Front');
  const back = faces.find(face => face.name === 'Back');
  const top = faces.find(face => face.name === 'Top');

  if (source.preset.handleStyle === 'slot') {
    for (const face of [front, back]) {
      if (!face) continue;
      const slotWidth = Math.min(56, Math.max(24, source.width * 0.3));
      const slotHeight = Math.min(12, Math.max(6, source.height * 0.12));
      objects.push(makeFeatureRectObject(
        layerId,
        'Box feature: Handle Slot',
        face,
        (source.width - slotWidth) / 2,
        (source.height - slotHeight) / 2,
        slotWidth,
        slotHeight,
      ));
    }
  }

  if (presetNeedsVentSlots(source.preset)) {
    const face = top ?? front;
    if (face) {
      const dims = faceDimensions(face, source);
      const slotCount = 4;
      const slotWidth = Math.min(7, Math.max(3, dims.width * 0.04));
      const slotHeight = Math.min(32, Math.max(12, dims.height * 0.42));
      const gap = slotWidth * 1.25;
      const totalWidth = slotCount * slotWidth + (slotCount - 1) * gap;
      const startX = (dims.width - totalWidth) / 2;
      const y = (dims.height - slotHeight) / 2;
      for (let i = 0; i < slotCount; i++) {
        objects.push(makeFeatureRectObject(
          layerId,
          'Box feature: Vent Slot',
          face,
          startX + i * (slotWidth + gap),
          y,
          slotWidth,
          slotHeight,
        ));
      }
    }
  }

  if (source.preset.lidType === 'lift-off' && !source.openTop && top) {
    const slotWidth = Math.min(46, Math.max(20, source.width * 0.22));
    const slotHeight = Math.min(10, Math.max(5, source.depth * 0.08));
    objects.push(makeFeatureRectObject(
      layerId,
      'Box feature: Lid Pull Slot',
      top,
      (source.width - slotWidth) / 2,
      Math.max(source.thickness * 2, source.depth * 0.16),
      slotWidth,
      slotHeight,
    ));
  }

  return objects;
}

function presetNeedsVentSlots(preset: BoxLibraryPreset): boolean {
  return preset.previewVariant === 'electronics-box'
    || preset.tags.some(tag => tag.toLowerCase().includes('vent'))
    || preset.featureBadges.some(badge => badge.toLowerCase().includes('vent'));
}

function faceDimensions(face: BoxFace, source: BoxFeatureSource): { width: number; height: number } {
  if (face.name === 'Top' || face.name === 'Bottom') {
    return { width: source.width, height: source.depth };
  }
  if (face.name === 'Left' || face.name === 'Right') {
    return { width: source.depth, height: source.height };
  }
  return { width: source.width, height: source.height };
}

function makeFeatureRectObject(
  layerId: string,
  name: string,
  face: BoxFace,
  x: number,
  y: number,
  width: number,
  height: number,
): SceneObject {
  return {
    id: generateId(),
    type: 'polygon',
    name,
    layerId,
    parentId: null,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: face.offsetX + 20, ty: face.offsetY + 20 },
    geometry: {
      type: 'polygon',
      points: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
      closed: true,
    },
    visible: true,
    locked: false,
    powerScale: 1.0,
    _bounds: null,
    _worldTransform: null,
  };
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
