import { useStore } from '../state';

export function deleteSelection(): void {
  const state = useStore.getState();
  if (state.selectedPathNode !== null) {
    state.deleteSelectedPathNodes();
    return;
  }
  const ids = [
    ...(state.selectedObjectId !== null ? [state.selectedObjectId] : []),
    ...state.additionalSelectedIds,
  ];
  state.removeSceneObjects(ids);
}
