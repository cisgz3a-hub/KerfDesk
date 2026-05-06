import { create, type StoreApi, type UseBoundStore } from 'zustand';

// T2-6: viewport-owned layout snapshots shared by canvas overlays.
export interface BedTabLayout {
  readonly bedScreenX: number;
  readonly bedScreenY: number;
  readonly zoom: number;
}

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

export interface ViewportState {
  zoomLevel: number;
  canvasSize: CanvasSize;
  previewMode: boolean;
  bedTabLayout: BedTabLayout;
}

export interface ViewportActions {
  setZoomLevel: (zoomLevel: number) => void;
  setCanvasSize: (size: CanvasSize) => void;
  setPreviewMode: (enabled: boolean) => void;
  togglePreviewMode: () => void;
  setBedTabLayout: (layout: BedTabLayout) => void;
  resetViewport: () => void;
}

export type ViewportStore = ViewportState & ViewportActions;

export const viewportInitialState: ViewportState = {
  zoomLevel: 100,
  canvasSize: {
    width: 800,
    height: 600,
  },
  previewMode: false,
  bedTabLayout: {
    bedScreenX: 0,
    bedScreenY: 0,
    zoom: 1.5,
  },
};

export function createViewportStore(): UseBoundStore<StoreApi<ViewportStore>> {
  return create<ViewportStore>((set) => ({
    ...viewportInitialState,
    setZoomLevel: (zoomLevel) => set({ zoomLevel }),
    setCanvasSize: (size) => set(state => {
      if (state.canvasSize.width === size.width && state.canvasSize.height === size.height) {
        return state;
      }
      return { canvasSize: size };
    }),
    setPreviewMode: (enabled) => set({ previewMode: enabled }),
    togglePreviewMode: () => set(state => ({ previewMode: !state.previewMode })),
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
