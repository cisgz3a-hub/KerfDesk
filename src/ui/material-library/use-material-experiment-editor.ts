import { useEffect, useRef, useState } from 'react';
import type { MaterialExperiment } from '../../core/material-library/material-experiment';
import { handleSaveMaterialLibrary } from '../app/material-library-file-actions';
import { usePlatform } from '../app/platform-context';
import { pickPlatformImageFile } from '../commands/platform-image-files';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { readExperimentPhoto } from './experiment-photo';

export function useMaterialExperimentEditor(experiment: MaterialExperiment) {
  const [draft, setDraft] = useState(experiment);
  const [recipeName, setRecipeName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const owner = useRef(useStore.getState().materialLibrary?.libraryId);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const platform = usePlatform();
  const pushToast = useToastStore((state) => state.pushToast);
  const save = (): boolean => {
    const state = useStore.getState();
    if (state.materialLibrary?.libraryId !== owner.current) {
      setStatus('Open the original library before saving this experiment.');
      return false;
    }
    const result = state.upsertMaterialExperiment(draft);
    setStatus(
      result.kind === 'invalid'
        ? result.reason
        : 'Experiment saved in this library. Export a copy for a portable backup.',
    );
    return result.kind === 'ok';
  };
  const loadPhoto = async (): Promise<void> => {
    setBusy(true);
    try {
      const file = await pickPlatformImageFile(platform);
      if (file === null || !live.current) return;
      const photo = await readExperimentPhoto(file);
      if (live.current) setDraft((current) => ({ ...current, photo }));
    } catch (error) {
      if (live.current)
        setStatus(error instanceof Error ? error.message : 'Could not read the photo.');
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const exportLibrary = (): void => {
    if (!save()) return;
    const state = useStore.getState();
    if (state.materialLibrary !== null)
      void handleSaveMaterialLibrary({
        platform,
        library: state.materialLibrary,
        markMaterialLibrarySaved: state.markMaterialLibrarySaved,
        pushToast,
      });
  };
  const saveRecipe = (): void => {
    if (!save() || draft.selectedCellId === undefined) return;
    const state = useStore.getState();
    const result = state.saveExperimentCellAsRecipe(draft.id, draft.selectedCellId, recipeName);
    setStatus(
      result.kind === 'invalid'
        ? result.reason
        : 'Saved recipe with a reference to this experiment cell.',
    );
    const updated = currentExperiment(draft.id);
    if (updated !== undefined) setDraft(updated);
  };
  return {
    draft,
    setDraft,
    recipeName,
    setRecipeName,
    status,
    busy,
    loadPhoto,
    exportLibrary,
    saveRecipe,
    save,
  };
}

function currentExperiment(id: string): MaterialExperiment | undefined {
  return useStore.getState().materialLibrary?.experiments?.find((record) => record.id === id);
}
