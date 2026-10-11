import { create } from 'zustand';
import type { DeviceProfile } from '../../core/devices';
import {
  primaryOperationForObject,
  sceneObjectUsesOperation,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { useStore, type AppState } from '../state';
import { useToastStore } from '../state/toast-store';
import { photoEngravingOwnerIsCurrent, type PhotoEngravingOwner } from './photo-engraving-apply';

export type PhotoEngravingSession = PhotoEngravingOwner & {
  readonly sessionId: string;
  readonly device: DeviceProfile;
  readonly sceneObjects: readonly SceneObject[];
};

export const usePhotoEngravingStore = create<{
  readonly session: PhotoEngravingSession | null;
  readonly close: (owner: PhotoEngravingSession) => void;
}>((set) => ({
  session: null,
  close: (owner) => set((state) => (state.session === owner ? { session: null } : state)),
}));

export function photoEngravingSessionIsCurrent(
  state: AppState,
  session: PhotoEngravingSession,
): boolean {
  const maskId = session.image.imageMaskId;
  return (
    photoEngravingOwnerIsCurrent(state, session) &&
    state.project.device === session.device &&
    (state.project.machine?.kind ?? 'laser') === 'laser' &&
    state.project.scene.objects.find((object) => object.id === maskId) ===
      session.sceneObjects.find((object) => object.id === maskId)
  );
}

/** Prefer an operation that will engrave; canvas visibility does not control output. */
export function photoEngravingOperationForImage(
  image: RasterImage,
  operations: readonly Layer[],
): Layer | null {
  return (
    operations.find(
      (operation) => operation.output && sceneObjectUsesOperation(image, operation),
    ) ?? primaryOperationForObject(image, operations)
  );
}

export function openPhotoEngraving(): void {
  const state = useStore.getState();
  const image = state.project.scene.objects.find((item) => item.id === state.selectedObjectId);
  if (
    (state.project.machine?.kind ?? 'laser') !== 'laser' ||
    image?.kind !== 'raster-image' ||
    image.locked === true ||
    image.role === 'trace-source' ||
    state.additionalSelectedIds.size > 0
  ) {
    useToastStore.getState().pushToast('Select one unlocked photo in the laser workspace.', 'info');
    return;
  }
  const operation = photoEngravingOperationForImage(image, state.project.scene.layers);
  if (operation === null) return;
  usePhotoEngravingStore.setState({
    session: {
      sessionId: crypto.randomUUID(),
      projectDocumentEpoch: state.projectDocumentEpoch,
      image,
      operation,
      device: state.project.device,
      sceneObjects: state.project.scene.objects,
    },
  });
}
