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
  readonly commitRequest: symbol | null;
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
  commitRequest: null,
  text: '',
  fontKey: 'roboto-regular',
  sizePx: 48,
  ink: 'black',

  open: () => {
    const editor = useImageEditorStore.getState();
    if (editor.session === null) return;
    // Opening a modal tool commits the active transform, matching Enter and
    // avoiding a visible button that silently does nothing.
    if (editor.transform !== null) editor.commitTransform();
    const current = useImageEditorStore.getState();
    if (current.session === null || current.transform !== null) return;
    set({ isOpen: true, text: '', commitRequest: null });
  },
  close: () => set({ isOpen: false, commitRequest: null }),
  setText: (text) => set({ text }),
  setFontKey: (fontKey) => set({ fontKey }),
  setSizePx: (sizePx) => {
    if (Number.isFinite(sizePx) && sizePx > 0) set({ sizePx });
  },
  setInk: (ink) => set({ ink }),

  commit: async () => {
    const { text, fontKey, sizePx, ink } = get();
    const editor = useImageEditorStore.getState();
    const session = editor.session;
    const sessionOwner = editor.sessionOwner;
    if (session === null) {
      set({ isOpen: false, commitRequest: null });
      return;
    }
    const commitRequest = Symbol(session.objectId);
    set({ commitRequest });
    const buffer = await rasterizeTextLayer(session.doc.width, session.doc.height, {
      text,
      fontKey,
      sizePx,
      color: ink === 'black' ? BLACK : WHITE,
    });
    // Re-read: the async render may have outlived this exact session, owner,
    // dialog, or a later commit request. Object ids alone are not ownership.
    const current = useImageEditorStore.getState();
    if (
      buffer === null ||
      get().commitRequest !== commitRequest ||
      current.session !== session ||
      current.sessionOwner !== sessionOwner
    ) {
      return;
    }
    set({ isOpen: false, commitRequest: null });
    useImageEditorStore.setState({
      session: addTextLayer(session, crypto.randomUUID(), layerName(text), buffer),
    });
  },
}));

function layerName(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const label = firstLine.length === 0 ? 'Text' : firstLine;
  return label.length > MAX_LAYER_NAME ? `${label.slice(0, MAX_LAYER_NAME - 1)}…` : label;
}
