import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { createLayer, type Layer } from '../../core/scene/Layer';
import { type SceneObject } from '../../core/scene/SceneObject';
import { remapClonedParentIds } from '../../core/scene/SceneOps';
import { type GridArrayConfig } from '../components/GridArrayDialog';
import { type Template } from '../../templates/TemplateLibrary';
import { computeObjectBounds } from '../../geometry/bounds';
import { generateId } from '../../core/types';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { assertFeature } from '../../entitlements';
import { type SceneCommitAction } from '../scene/SceneCommitActions';
import {
  assignObjectsToTextOperationLayer,
  type TextOperationMode,
} from '../scene/TextOperationLayer';

export interface UseGeneratorHandlersParams {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  setSelectedIds: (ids: ReadonlySet<string>) => void;
  handleSceneCommit: (newScene: Scene, action?: SceneCommitAction, selectionAfter?: ReadonlySet<string>) => void;
  setShowGridArray: (show: boolean) => void;
  setShowTemplates: (show: boolean) => void;
  showAlert: (title: string, message: string) => Promise<unknown>;
}

export interface GeneratorHandlers {
  handleGridArrayConfirm: (config: GridArrayConfig) => void;
  handleNestingApply: (newObjects: SceneObject[]) => void;
  handleBoxGenerate: (objects: SceneObject[]) => void;
  handleVariableTextGenerate: (objects: SceneObject[], operationMode: TextOperationMode) => void;
  handleTemplateSelect: (template: Template) => Promise<void>;
}

export function useGeneratorHandlers(params: UseGeneratorHandlersParams): GeneratorHandlers {
  const {
    scene,
    selectedIds,
    setSelectedIds,
    handleSceneCommit,
    setShowGridArray,
    setShowTemplates,
    showAlert,
  } = params;

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
        const oldToNewId = new Map<string, string>();
        const cellClones: typeof scene.objects = [];

        for (const obj of selected) {
          const newId = generateId();
          oldToNewId.set(obj.id, newId);

          cellClones.push({
            ...obj,
            id: newId,
            name: obj.name,
            powerScale: obj.powerScale ?? 1,
            transform: { ...obj.transform, tx: obj.transform.tx + dx, ty: obj.transform.ty + dy },
            _bounds: null,
            _worldTransform: null,
          });
        }
        allClones.push(...remapClonedParentIds(cellClones, oldToNewId));
      }
    }

    const newScene = { ...scene, objects: [...scene.objects, ...allClones] };
    handleSceneCommit(newScene, 'array-clone');
  }, [scene, selectedIds, handleSceneCommit, setShowGridArray]);

  const handleNestingApply = useCallback((newObjects: SceneObject[]) => {
    const newScene = { ...scene, objects: newObjects };
    handleSceneCommit(newScene, 'nesting');
  }, [scene, handleSceneCommit]);

  /** Shared body for append generated objects + select them (was duplicated in App for box + variable text). */
  const commitGeneratedObjects = useCallback(
    (objects: SceneObject[], action: SceneCommitAction) => {
      const newScene = {
        ...scene,
        objects: [...scene.objects, ...objects],
      };
      handleSceneCommit(newScene, action);
      setSelectedIds(new Set(objects.map(o => o.id)));
    },
    [scene, handleSceneCommit, setSelectedIds],
  );

  const handleBoxGenerate = useCallback(
    (objects: SceneObject[]) => {
      const fitCheck = checkGeneratedBoxLayoutFits(scene, objects);
      if (!fitCheck.ok) {
        void showAlert(
          'Box Layout Too Large',
          `The generated box layout is about ${fitCheck.layoutWidth.toFixed(1)} x ${fitCheck.layoutHeight.toFixed(1)} mm and exceeds the current material or canvas (${fitCheck.targetWidth.toFixed(1)} x ${fitCheck.targetHeight.toFixed(1)} mm). Reduce the box size, use a larger work area, or split the layout before inserting it.`,
        );
        return;
      }
      const target = resolveBoxGeneratedCutLayer(scene);
      const assignedObjects = objects.map(obj => ({
        ...obj,
        layerId: target.layerId,
        _bounds: null,
        _worldTransform: null,
      }));
      const newScene = {
        ...target.scene,
        objects: [...target.scene.objects, ...assignedObjects],
      };
      handleSceneCommit(newScene, 'box-generate');
      setSelectedIds(new Set(assignedObjects.map(o => o.id)));
    },
    [scene, handleSceneCommit, setSelectedIds, showAlert],
  );
  const handleVariableTextGenerate = useCallback((objects: SceneObject[], operationMode: TextOperationMode) => {
    // T1-78 Phase 2b: enforcement → assertFeature (throws EntitlementError).
    assertFeature('variable_text');
    const assigned = assignObjectsToTextOperationLayer(scene, objects, operationMode);
    const newScene = {
      ...assigned.scene,
      objects: [...assigned.scene.objects, ...assigned.objects],
    };
    handleSceneCommit(newScene, 'var-text-generate');
    setSelectedIds(new Set(assigned.objects.map(o => o.id)));
  }, [scene, handleSceneCommit, setSelectedIds]);

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
      handleSceneCommit(newScene, 'template-import');
    } catch (e) {
      await showAlert('Template', 'Failed to load template: ' + (e as Error).message);
    }
  }, [scene, handleSceneCommit, setShowTemplates, showAlert]);

  return {
    handleGridArrayConfirm,
    handleNestingApply,
    handleBoxGenerate,
    handleVariableTextGenerate,
    handleTemplateSelect,
  };
}

interface BoxLayoutFitResult {
  ok: boolean;
  layoutWidth: number;
  layoutHeight: number;
  targetWidth: number;
  targetHeight: number;
}

function checkGeneratedBoxLayoutFits(scene: Scene, objects: readonly SceneObject[]): BoxLayoutFitResult {
  const target = scene.material
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
      };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const object of objects) {
    const bounds = computeObjectBounds(object);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  const targetWidth = Math.max(0, target.maxX - target.minX);
  const targetHeight = Math.max(0, target.maxY - target.minY);
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { ok: true, layoutWidth: 0, layoutHeight: 0, targetWidth, targetHeight };
  }

  const layoutWidth = Math.max(0, maxX - minX);
  const layoutHeight = Math.max(0, maxY - minY);
  const ok = minX >= target.minX
    && minY >= target.minY
    && maxX <= target.maxX
    && maxY <= target.maxY;
  return { ok, layoutWidth, layoutHeight, targetWidth, targetHeight };
}

function isBoxGeneratedCutLayer(layer: Layer | undefined): layer is Layer {
  return layer != null
    && layer.settings.mode === 'cut'
    && layer.output === true
    && layer.visible === true
    && layer.locked === false;
}

function resolveBoxGeneratedCutLayer(scene: Scene): { scene: Scene; layerId: string } {
  const activeLayer = scene.layers.find(layer => layer.id === scene.activeLayerId);
  if (isBoxGeneratedCutLayer(activeLayer)) {
    return { scene, layerId: activeLayer.id };
  }

  const existingCutLayer = scene.layers.find(isBoxGeneratedCutLayer);
  if (existingCutLayer) {
    return {
      scene: { ...scene, activeLayerId: existingCutLayer.id },
      layerId: existingCutLayer.id,
    };
  }

  const maxOrder = scene.layers.reduce((max, layer) => Math.max(max, layer.order), -1);
  const boxCutLayer = createLayer(maxOrder + 1, 'cut', 'Box Cut');
  return {
    scene: {
      ...scene,
      layers: [...scene.layers, boxCutLayer],
      activeLayerId: boxCutLayer.id,
    },
    layerId: boxCutLayer.id,
  };
}
