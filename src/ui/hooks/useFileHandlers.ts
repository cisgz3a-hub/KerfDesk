import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { createScene, type Scene } from '../../core/scene/Scene';
import { deserializeScene, serializeForAutosave } from '../../io/SceneSerializer';
import { saveSceneToFile } from '../../io/FileIO';
import { writeAutosave, clearAutosave } from '../../app/autosavePersistence';

export interface UseFileHandlersParams {
  scene: Scene;
  setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  handleNewProject: (scene: Scene) => void;
  sceneIsDirtyRef: MutableRefObject<boolean>;
  lastSavedSceneRef: MutableRefObject<string>;
  showAlert: (title: string, message: string) => Promise<unknown>;
  showConfirm: (title: string, message: string) => Promise<boolean>;
}

export interface FileHandlers {
  syncAutosaveAfterFileSave: () => void;
  handleKeyboardSave: () => Promise<void>;
  handleKeyboardOpen: () => void;
  handleKeyboardNew: () => Promise<void>;
  handleClearSelection: () => void;
}

export function useFileHandlers(params: UseFileHandlersParams): FileHandlers {
  const {
    scene,
    setSelectedIds,
    handleNewProject,
    sceneIsDirtyRef,
    lastSavedSceneRef,
    showAlert,
    showConfirm,
  } = params;

  const syncAutosaveAfterFileSave = useCallback(() => {
    sceneIsDirtyRef.current = false;
    try {
      const json = serializeForAutosave(scene);
      writeAutosave(json);
      lastSavedSceneRef.current = json;
    } catch { /* ignore */ }
  }, [scene]);

  const handleKeyboardSave = useCallback(async () => {
    try {
      await saveSceneToFile(scene);
      syncAutosaveAfterFileSave();
    } catch (e) {
      await showAlert('Save Failed', 'Save failed: ' + (e as Error).message);
    }
  }, [scene, showAlert, syncAutosaveAfterFileSave]);

  const handleKeyboardOpen = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.laserforge.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const loadedScene = deserializeScene(text);
        handleNewProject(loadedScene);
      } catch (err) {
        await showAlert('Import Failed', 'Import failed: ' + (err as Error).message);
      }
    };
    input.click();
  }, [handleNewProject, showAlert]);

  const handleKeyboardNew = useCallback(async () => {
    if (scene.objects.length > 0) {
      const ok = await showConfirm('New Project', 'Start a new project? Unsaved changes will be lost.');
      if (!ok) return;
    }
    clearAutosave();
    handleNewProject(createScene(scene.canvas.width, scene.canvas.height, 'Untitled'));
  }, [scene.canvas.width, scene.canvas.height, scene.objects.length, handleNewProject, showConfirm]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    syncAutosaveAfterFileSave,
    handleKeyboardSave,
    handleKeyboardOpen,
    handleKeyboardNew,
    handleClearSelection,
  };
}
