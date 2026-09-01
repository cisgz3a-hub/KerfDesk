// Text dialog state (ADR-246, V2 plan C). Its own small store: text is
// transient UI ephemera and the session store sits at its size cap. Commit
// rasterizes the glyphs into a new transparent layer (addTextLayer).

import { create } from 'zustand';
import { rasterizeTextLayer, type TextLayerSpec } from './editor-text-raster';
import type { EditorSession } from './editor-session';
import { addTextLayer } from './editor-session-layers';
import { useImageEditorStore, type ImageEditorState } from './image-editor-store';
import type { ImageEditorSessionOwner } from './image-editor-ownership';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const MAX_LAYER_NAME = 24;
const RETIRED_REQUEST = { commitRequest: null, errorMessage: null } as const;
const CLOSED_DIALOG = {
  isOpen: false,
  dialogOwner: null,
  text: '',
  ...RETIRED_REQUEST,
} as const;

export type TextDialogOwner = {
  readonly session: EditorSession;
  readonly sessionOwner: ImageEditorSessionOwner | null;
};

export type TextDialogState = {
  readonly isOpen: boolean;
  readonly dialogOwner: TextDialogOwner | null;
  readonly commitRequest: symbol | null;
  readonly errorMessage: string | null;
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
  dialogOwner: null,
  commitRequest: null,
  errorMessage: null,
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
    set({
      isOpen: true,
      dialogOwner: { session: current.session, sessionOwner: current.sessionOwner },
      text: '',
      ...RETIRED_REQUEST,
    });
  },
  close: () => set(CLOSED_DIALOG),
  setText: (text) => set({ text, ...RETIRED_REQUEST }),
  setFontKey: (fontKey) => set({ fontKey, ...RETIRED_REQUEST }),
  setSizePx: (sizePx) => {
    if (Number.isFinite(sizePx) && sizePx > 0) set({ sizePx, ...RETIRED_REQUEST });
    else set(RETIRED_REQUEST);
  },
  setInk: (ink) => set({ ink, ...RETIRED_REQUEST }),

  commit: async () => {
    const { isOpen, dialogOwner, text, fontKey, sizePx, ink } = get();
    if (!isOpen || dialogOwner === null) return;
    const editor = useImageEditorStore.getState();
    if (!dialogOwnerMatchesEditor(dialogOwner, editor)) {
      retireDialogOwner(dialogOwner);
      return;
    }
    const { session } = dialogOwner;
    const commitRequest = Symbol(session.objectId);
    set({ commitRequest, errorMessage: null });
    let buffer: Awaited<ReturnType<typeof rasterizeTextLayer>>;
    try {
      buffer = await rasterizeTextLayer(session.doc.width, session.doc.height, {
        text,
        fontKey,
        sizePx,
        color: ink === 'black' ? BLACK : WHITE,
      });
    } catch (error) {
      // A close, retry, or replacement session retires this request. Its
      // rejection must not publish feedback into the newer dialog/session.
      const current = useImageEditorStore.getState();
      if (!requestIsCurrent(get(), dialogOwner, commitRequest)) return;
      if (!dialogOwnerMatchesEditor(dialogOwner, current)) {
        retireDialogOwner(dialogOwner);
        return;
      }
      set({ commitRequest: null, errorMessage: textRasterError(error) });
      return;
    }
    // Re-read: the async render may have outlived this exact session, owner,
    // dialog, or a later commit request. Object ids alone are not ownership.
    const current = useImageEditorStore.getState();
    if (!requestIsCurrent(get(), dialogOwner, commitRequest)) return;
    if (!dialogOwnerMatchesEditor(dialogOwner, current)) {
      retireDialogOwner(dialogOwner);
      return;
    }
    if (buffer === null) {
      set({
        commitRequest: null,
        errorMessage: 'Could not add text: no rendered pixels were produced.',
      });
      return;
    }
    set(CLOSED_DIALOG);
    useImageEditorStore.setState({
      session: addTextLayer(session, crypto.randomUUID(), layerName(text), buffer),
    });
  },
}));

function dialogOwnerMatchesEditor(
  owner: TextDialogOwner,
  editor: Pick<ImageEditorState, 'session' | 'sessionOwner'>,
): boolean {
  return editor.session === owner.session && editor.sessionOwner === owner.sessionOwner;
}

function requestIsCurrent(
  state: TextDialogState,
  owner: TextDialogOwner,
  request: symbol,
): boolean {
  return state.isOpen && state.dialogOwner === owner && state.commitRequest === request;
}

function retireDialogOwner(owner: TextDialogOwner): void {
  useTextDialogStore.setState((state) => (state.dialogOwner === owner ? CLOSED_DIALOG : {}));
}

// A Text draft belongs to the exact session and source owner that opened it.
// Closing, replacing, or removing either identity retires the draft and any
// raster request before that old work can publish into a later editor.
useImageEditorStore.subscribe((state, previous) => {
  if (state.session === previous.session && state.sessionOwner === previous.sessionOwner) return;
  const owner = useTextDialogStore.getState().dialogOwner;
  if (owner !== null && !dialogOwnerMatchesEditor(owner, state)) retireDialogOwner(owner);
});

function textRasterError(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : String(error).trim();
  return detail.length === 0 ? 'Could not add text.' : `Could not add text: ${detail}`;
}

function layerName(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const label = firstLine.length === 0 ? 'Text' : firstLine;
  return label.length > MAX_LAYER_NAME ? `${label.slice(0, MAX_LAYER_NAME - 1)}…` : label;
}
