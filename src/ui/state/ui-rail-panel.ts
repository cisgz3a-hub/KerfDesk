export type RailPanelId = 'layers' | 'machine';
export type RailPanelVisibility = Readonly<Record<RailPanelId, boolean>>;
export type CutsLayersView = 'layers' | 'run-order' | 'materials';
export type RailPanelFocusRequest = {
  readonly panel: RailPanelId;
  readonly requestId: number;
};

export type UiRailPanelState = {
  readonly railPanelVisibility: RailPanelVisibility;
  readonly setRailPanelVisible: (panel: RailPanelId, visible: boolean) => void;
  readonly toggleRailPanel: (panel: RailPanelId) => void;
  readonly railPanelFocusRequest: RailPanelFocusRequest | null;
  readonly focusRailPanel: (panel: RailPanelId) => void;
  readonly cutsLayersView: CutsLayersView;
  readonly setCutsLayersView: (view: CutsLayersView) => void;
};

type UiRailPanelSetter = (
  partial: Partial<UiRailPanelState> | ((state: UiRailPanelState) => Partial<UiRailPanelState>),
) => void;

export function uiRailPanelSlice(set: UiRailPanelSetter): UiRailPanelState {
  return {
    railPanelVisibility: { layers: true, machine: true },
    setRailPanelVisible: (panel, visible) =>
      set((state) => ({
        railPanelVisibility: { ...state.railPanelVisibility, [panel]: visible },
      })),
    toggleRailPanel: (panel) =>
      set((state) => ({
        railPanelVisibility: {
          ...state.railPanelVisibility,
          [panel]: !state.railPanelVisibility[panel],
        },
      })),
    railPanelFocusRequest: null,
    focusRailPanel: (panel) =>
      set((state) => ({
        railPanelVisibility: { ...state.railPanelVisibility, [panel]: true },
        railPanelFocusRequest: {
          panel,
          requestId: (state.railPanelFocusRequest?.requestId ?? 0) + 1,
        },
      })),
    cutsLayersView: 'layers',
    setCutsLayersView: (view) => set({ cutsLayersView: view }),
  };
}
