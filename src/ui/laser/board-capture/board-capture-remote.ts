import { create } from 'zustand';

export type BoardRemoteStatus = {
  readonly panelOpen: boolean;
  readonly shape: 'rect' | 'circle' | 'outline';
  readonly committed: boolean;
  readonly captures: number;
  readonly capturesNeeded: number | null;
  readonly hasOutlineDraft: boolean;
  readonly coordinatesCurrent: boolean;
  readonly busy: boolean;
  readonly board: null | {
    readonly kind: 'rect' | 'circle' | 'outline';
    readonly widthMm: number;
    readonly heightMm: number;
    readonly anchors?: number;
    readonly checkedAnchors?: number;
    readonly maxMissMm?: number;
  };
};

export type BoardRemoteController = {
  readonly status: () => BoardRemoteStatus;
  readonly capture: () => Promise<void>;
  readonly finish: () => Promise<void>;
};

let current: BoardRemoteController | null = null;

export function registerBoardRemote(controller: BoardRemoteController): () => void {
  current = controller;
  return () => {
    if (current === controller) current = null;
  };
}

export function currentBoardRemote(): BoardRemoteController | null {
  return current;
}

type BoardPhotoInbox = {
  readonly photo: File | null;
  readonly deliver: (file: File) => void;
  readonly take: () => File | null;
};

export const useBoardPhotoInbox = create<BoardPhotoInbox>((set, get) => ({
  photo: null,
  deliver: (photo) => set({ photo }),
  take: () => {
    const photo = get().photo;
    if (photo !== null) set({ photo: null });
    return photo;
  },
}));
