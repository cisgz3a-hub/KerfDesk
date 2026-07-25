// Which view the MAIN canvas is showing (ADR-255 stage 9b).
//
// A store rather than local state because the entry point is the toolbar
// command: "Inspect G-code (3D)" switches the canvas into the G-code view,
// and the view itself offers the way back. The design canvas stays
// uncluttered — no permanent switch sitting on top of the artwork.

import { create } from 'zustand';

export type CanvasViewState = {
  readonly showGcode: boolean;
  readonly setShowGcode: (showGcode: boolean) => void;
};

export const useCanvasViewStore = create<CanvasViewState>((set) => ({
  showGcode: false,
  setShowGcode: (showGcode) => set({ showGcode }),
}));
