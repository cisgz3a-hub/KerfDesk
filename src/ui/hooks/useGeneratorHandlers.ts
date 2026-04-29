import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { type GridArrayConfig } from '../components/GridArrayDialog';
import { type Template } from '../../templates/TemplateLibrary';
import { computeObjectBounds } from '../../geometry/bounds';
import { generateId } from '../../core/types';
import { importSvgIntoScene } from '../../import/svg/SvgToScene';
import { requireFeature } from '../../entitlements';
import { type SceneCommitAction } from '../scene/SceneCommitActions';

export interface UseGeneratorHandlersParams {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  handleSceneCommit: (newScene: Scene, action?: SceneCommitAction, selectionAfter?: ReadonlySet<string>) => void;
  setShowGridArray: (show: boolean) => void;
  setShowTemplates: (show: boolean) => void;
  showAlert: (title: string, message: string) => Promise<unknown>;
}

export interface GeneratorHandlers {
  handleGridArrayConfirm: (config: GridArrayConfig) => void;
  handleNestingApply: (newObjects: SceneObject[]) => void;
  handleBoxGenerate: (objects: SceneObject[]) => void;
  handleVariableTextGenerate: (objects: SceneObject[]) => void;
  handleTemplateSelect: (template: Template) => Promise<void>;
}

export function useGeneratorHandlers(params: UseGeneratorHandlersParams): GeneratorHandlers {
  const {
    scene,
    selectedIds,
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
            powerScale: obj.powerScale ?? 1,
            transform: { ...obj.transform, tx: obj.transform.tx + dx, ty: obj.transform.ty + dy },
            _bounds: null,
            _worldTransform: null,
          });
        }
      }
    }

    const newScene = { ...scene, objects: [...scene.objects, ...allClones] };
    handleSceneCommit(newScene, 'array-clone');
  }, [scene, selectedIds, handleSceneCommit]);

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
      handleSceneCommit(newScene, action, new Set(objects.map(o => o.id)));
    },
    [scene, handleSceneCommit],
  );

  const handleBoxGenerate = useCallback(
    (objects: SceneObject[]) => commitGeneratedObjects(objects, 'box-generate'),
    [commitGeneratedObjects],
  );
  const handleVariableTextGenerate = useCallback((objects: SceneObject[]) => {
    if (!requireFeature('variable_text')) {
      throw new Error('Variable text requires a Pro license');
    }
    commitGeneratedObjects(objects, 'var-text-generate');
  }, [commitGeneratedObjects]);

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
  }, [scene, handleSceneCommit, showAlert]);

  return {
    handleGridArrayConfirm,
    handleNestingApply,
    handleBoxGenerate,
    handleVariableTextGenerate,
    handleTemplateSelect,
  };
}
