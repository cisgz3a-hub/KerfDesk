// Text dialog state (ADR-246, V2 plan C). Its own small store: text is
// transient UI ephemera and the session store sits at its size cap. Commit
// rasterizes the glyphs into a new transparent layer (addTextLayer).

import { create } from 'zustand';
import { rasterizeTextLayer, type TextLayerSpec } from './editor-text-raster';
import { addTextLayer } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const MAX_LAYER_NAME = 24;

export type TextDialogState = {
  readonly isOpen: boolean;
  readonly text: string;
  readonly fontKey: TextLayerSpec['fontKey'];
  readonly sizePx: number;
  readonly ink: 'black' | 'white';
  readonly open: () => void;
  readonly close: () => void;
  readonly setText: (text: string) => void;
  readonly setFontKey: (fontKey: TextLayerSpec['fontKey']) => void;
  readonly setSizePx: (sizePx: number) => void;
  readonly setInk: (ink: 'black' | 'white') => void;
  readonly commit: () => Promise<void>;
};

export const useTextDialogStore = create<TextDialogState>((set, get) => ({
  isOpen: false,
  text: '',
  fontKey: 'roboto-regular',
  sizePx: 48,
  ink: 'black',

  open: () => {
    // Only over a live session; a transform in progress owns the canvas.
    const editor = useImageEditorStore.getState();
    if (editor.session === null || editor.transform !== null) return;
    set({ isOpen: true, text: '' });
  },
  close: () => set({ isOpen: false }),
  setText: (text) => set({ text }),
  setFontKey: (fontKey) => set({ fontKey }),
  setSizePx: (sizePx) => set({ sizePx: Math.max(4, Math.min(512, Math.round(sizePx))) }),
  setInk: (ink) => set({ ink }),

  commit: async () => {
    const { text, fontKey, sizePx, ink } = get();
    const session = useImageEditorStore.getState().session;
    if (session === null) {
      set({ isOpen: false });
      return;
    }
    const buffer = await rasterizeTextLayer(session.doc.width, session.doc.height, {
      text,
      fontKey,
      sizePx,
      color: ink === 'black' ? BLACK : WHITE,
    });
    set({ isOpen: false });
    // Re-read: the async render may have outlived the session (close/switch).
    const current = useImageEditorStore.getState().session;
    if (buffer === null || current === null || current.objectId !== session.objectId) return;
    useImageEditorStore.setState({
      session: addTextLayer(current, crypto.randomUUID(), layerName(text), buffer),
    });
  },
}));

function layerName(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const label = firstLine.length === 0 ? 'Text' : firstLine;
  return label.length > MAX_LAYER_NAME ? `${label.slice(0, MAX_LAYER_NAME - 1)}…` : label;
}
