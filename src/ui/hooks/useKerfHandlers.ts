import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { IDENTITY_MATRIX } from '../../core/types';
import { offsetObject } from '../../geometry/OffsetPath';

export interface UseKerfHandlersParams {
  scene: Scene;
  handleSceneCommit: (newScene: Scene) => void;
  showAlert: (title: string, message: string) => Promise<unknown>;
}

export interface KerfHandlers {
  handleKerfGenerateTest: (objects: SceneObject[]) => void;
  handleKerfApply: (offsetMm: number, objectIds: string[]) => Promise<void>;
  handleKerfSaveToPreset: (kerfMm: number) => void;
}

export function useKerfHandlers(params: UseKerfHandlersParams): KerfHandlers {
  const { scene, handleSceneCommit, showAlert } = params;

  const handleKerfGenerateTest = useCallback((objects: SceneObject[]) => {
    handleSceneCommit({
      ...scene,
      objects: [...scene.objects, ...objects],
    });
  }, [scene, handleSceneCommit]);

  const handleKerfApply = useCallback(async (offsetMm: number, objectIds: string[]) => {
    const idsSet = new Set(objectIds);
    const next: SceneObject[] = [];
    let changed = 0;
    for (const obj of scene.objects) {
      if (!idsSet.has(obj.id)) {
        next.push(obj);
        continue;
      }
      if (obj.locked || !obj.visible) {
        next.push(obj);
        continue;
      }
      const resultGeom = offsetObject(obj, offsetMm);
      if (!resultGeom) {
        next.push(obj);
        continue;
      }
      changed += 1;
      next.push({
        ...obj,
        type: 'path',
        name: obj.name.startsWith('Kerf Test') ? obj.name : `Kerf ${offsetMm >= 0 ? '+' : ''}${offsetMm.toFixed(3)}mm ${obj.name}`,
        transform: { ...IDENTITY_MATRIX },
        geometry: resultGeom,
        _bounds: null,
        _worldTransform: null,
      } as SceneObject);
    }
    if (changed === 0) {
      await showAlert('Kerf', 'Offset failed — select cut paths or shapes, or try a smaller kerf.');
      return;
    }
    handleSceneCommit({ ...scene, objects: next });
  }, [scene, handleSceneCommit, showAlert]);

  const handleKerfSaveToPreset = useCallback((kerfMm: number) => {
    try {
      localStorage.setItem('laserforge_kerf', String(kerfMm));
    } catch { /* ignore */ }
  }, []);

  return {
    handleKerfGenerateTest,
    handleKerfApply,
    handleKerfSaveToPreset,
  };
}
