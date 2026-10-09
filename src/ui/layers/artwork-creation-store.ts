import { create } from 'zustand';
import { requestProFeature } from '../licensing/edition';

export type ArtworkCreationKind = 'choose' | 'sketch' | 'part' | 'relief';
export const useArtworkCreationStore = create<{
  readonly kind: ArtworkCreationKind | null;
  readonly close: () => void;
}>(() => ({ kind: null, close: () => useArtworkCreationStore.setState({ kind: null }) }));

export function openArtworkCreation(kind: ArtworkCreationKind): void {
  const open = (): void => useArtworkCreationStore.setState({ kind });
  if (kind === 'relief') requestProFeature('relief', open);
  else open();
}
