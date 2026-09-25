import { create } from 'zustand';
import type { SceneObject } from '../../core/scene';
import type { PagedArtworkSource } from './paged-artwork-source';

export type PagedImportRequest = {
  readonly source: PagedArtworkSource;
  readonly isCurrent: () => boolean;
  readonly commit: (object: SceneObject) => void;
  readonly resolve: (object: SceneObject | null) => void;
};

type PagedImportState = {
  readonly request: PagedImportRequest | null;
  readonly generation: number;
  readonly open: (request: PagedImportRequest) => void;
  readonly finish: (request: PagedImportRequest, object: SceneObject | null) => void;
};

export const usePagedImportStore = create<PagedImportState>((set, get) => ({
  request: null,
  generation: 0,
  open: (request) => {
    if (get().request !== null || !request.isCurrent()) {
      request.resolve(null);
      return;
    }
    set({ request, generation: get().generation + 1 });
  },
  finish: (request, object) => {
    if (get().request !== request) return;
    set({ request: null });
    request.resolve(request.isCurrent() ? object : null);
  },
}));
