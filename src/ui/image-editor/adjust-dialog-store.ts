// Adjust-dialog state for the Image Studio (ADR-242, PP-E). Separate from
// the session store on purpose: dialog state is pure UI ephemera, and the
// session store sits at its size cap. Parameterless entries (Invert,
// Desaturate) skip the dialog and commit through the session immediately.

import { create } from 'zustand';
import type { RgbaBuffer } from '../../core/image-edit';
import { commitAdjustment, computeAdjustPreview } from './editor-adjust-session';
import { adjustmentById, defaultParams, type AdjustmentId } from './editor-adjustments';
import { useImageEditorStore } from './image-editor-store';

export type AdjustDialog = {
  readonly id: AdjustmentId;
  readonly params: Readonly<Record<string, number>>;
  /** Preview ✓ (Photoshop): off shows the untouched document. */
  readonly previewEnabled: boolean;
  /** Latest computed preview buffer; null until the first compute lands. */
  readonly previewDoc: RgbaBuffer | null;
};

type AdjustDialogState = {
  readonly dialog: AdjustDialog | null;
  readonly open: (id: AdjustmentId) => void;
  readonly setParams: (params: Readonly<Record<string, number>>) => void;
  readonly setPreviewEnabled: (enabled: boolean) => void;
  readonly setPreviewDoc: (doc: RgbaBuffer) => void;
  /** Reset every slider to its default (the Photoshop Alt-Reset behavior). */
  readonly reset: () => void;
  readonly commit: () => void;
  readonly cancel: () => void;
};

export const useAdjustDialogStore = create<AdjustDialogState>((set, get) => ({
  dialog: null,

  open: (id) => {
    const editor = useImageEditorStore.getState();
    if (editor.session === null || editor.transform !== null) return;
    const spec = adjustmentById(id);
    if (spec.params.length === 0) {
      useImageEditorStore.setState({ session: commitAdjustment(editor.session, id, {}) });
      return;
    }
    set({ dialog: { id, params: defaultParams(spec), previewEnabled: true, previewDoc: null } });
  },

  setParams: (params) =>
    set((s) =>
      s.dialog === null
        ? s
        : { dialog: { ...s.dialog, params: { ...s.dialog.params, ...params } } },
    ),

  setPreviewEnabled: (previewEnabled) =>
    set((s) => (s.dialog === null ? s : { dialog: { ...s.dialog, previewEnabled } })),

  setPreviewDoc: (previewDoc) =>
    set((s) => (s.dialog === null ? s : { dialog: { ...s.dialog, previewDoc } })),

  reset: () =>
    set((s) =>
      s.dialog === null
        ? s
        : {
            dialog: {
              ...s.dialog,
              params: defaultParams(adjustmentById(s.dialog.id)),
              previewDoc: null,
            },
          },
    ),

  commit: () => {
    const { dialog } = get();
    const editor = useImageEditorStore.getState();
    if (dialog === null || editor.session === null) return;
    set({ dialog: null });
    useImageEditorStore.setState({
      session: commitAdjustment(editor.session, dialog.id, dialog.params),
    });
  },

  cancel: () => set({ dialog: null }),
}));

/** The buffer the canvas should draw instead of the document, if any. */
export function useAdjustPreviewDoc(): RgbaBuffer | null {
  return useAdjustDialogStore((s) =>
    s.dialog !== null && s.dialog.previewEnabled ? s.dialog.previewDoc : null,
  );
}

/** Recompute the preview for the current dialog params (rAF-scheduled by the dialog). */
export function refreshAdjustPreview(): void {
  const { dialog, setPreviewDoc } = useAdjustDialogStore.getState();
  const { session } = useImageEditorStore.getState();
  if (dialog === null || session === null || !dialog.previewEnabled) return;
  setPreviewDoc(computeAdjustPreview(session, dialog.id, dialog.params));
}

// A closed or different session invalidates the dialog and its preview
// buffer (the overlay itself never asks anything on close — CLAUDE.md #7).
useImageEditorStore.subscribe((state, prev) => {
  if (state.session?.objectId === prev.session?.objectId) return;
  if (useAdjustDialogStore.getState().dialog !== null) {
    useAdjustDialogStore.getState().cancel();
  }
});
