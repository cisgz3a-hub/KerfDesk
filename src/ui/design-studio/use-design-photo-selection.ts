import { useEffect, useState } from 'react';
import { sceneObjectHasVisibleLayer } from '../../core/scene';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { useStore } from '../state';
import { useDesignStudioStore } from './design-studio-store';
import type { DesignPhotoActions } from './design-project-photos';

export function useDesignPhotoSelection(onEdit: () => void): DesignPhotoActions {
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const vectorsActive = useDesignStudioStore(
    (state) => state.session?.tool !== 'select' || (state.session?.selectedIds.size ?? 0) > 0,
  );
  useEffect(() => {
    if (vectorsActive) setSelectedPhotoId(null);
  }, [vectorsActive]);
  return {
    selectedPhotoId: vectorsActive ? null : selectedPhotoId,
    onSelectPhoto: setSelectedPhotoId,
    onEditPhoto(id) {
      const scene = useStore.getState().project.scene;
      const photo = scene.objects.find((object) => object.id === id);
      if (
        photo?.kind !== 'raster-image' ||
        photo.locked === true ||
        !sceneObjectHasVisibleLayer(scene, photo)
      )
        return;
      setSelectedPhotoId(id);
      useImageEditorStore.getState().openEditor(photo);
      onEdit();
    },
  };
}
