import { create, type StoreApi, type UseBoundStore } from 'zustand';

// T2-6: viewport-owned layout snapshots shared by canvas overlays.
export interface BedTabLayout {
  readonly bedScreenX: number;
  readonly bedScreenY: number;
  readonly zoom: number;
}

export interface ViewportState {
  bedTabLayout: BedTabLayout;
}

export interface ViewportActions {
  setBedTabLayout: (layout: BedTabLayout) => void;
  resetViewport: () => void;
}

export type ViewportStore = ViewportState & ViewportActions;

export const viewportInitialState: ViewportState = {
  bedTabLayout: {
    bedScreenX: 0,
    bedScreenY: 0,
    zoom: 1.5,
  },
};

export function createViewportStore(): UseBoundStore<StoreApi<ViewportStore>> {
  return create<ViewportStore>((set) => ({
    ...viewportInitialState,
    setBedTabLayout: (layout) => set(state => {
      if (
        state.bedTabLayout.bedScreenX === layout.bedScreenX &&
        state.bedTabLayout.bedScreenY === layout.bedScreenY &&
        state.bedTabLayout.zoom === layout.zoom
      ) {
        return state;
      }
      return { bedTabLayout: layout };
    }),
    resetViewport: () => set(viewportInitialState),
  }));
}

export const useViewportStore = createViewportStore();
