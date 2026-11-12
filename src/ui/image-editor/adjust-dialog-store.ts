// Adjust-dialog state for the Image Studio (ADR-242, PP-E). Separate from
// the session store on purpose: dialog state is pure UI ephemera, and the
// session store sits at its size cap. Parameterless entries (Invert,
// Desaturate) skip the dialog and commit through the session immediately.

import { create } from 'zustand';
import type { CurvePoint } from '../../core/image-adjust';
import type { PixelRect, RgbaBuffer } from '../../core/image-edit';
import {
  composeFilteredWindow,
  computeWindowPreview,
  previewWindow,
  selectionBounds,
  type AdjustPreviewCache,
  type AdjustRequest,
  type PreviewWindow,
} from './adjust-preview-window';
import { retireFilterPreviewWorker } from './adjust-filter-worker-client';
import {
  previewsInWorker,
  scheduleFilterPreview,
  stopFilterPreview,
} from './adjust-filter-preview';
import { commitAdjustment } from './editor-adjust-session';
import {
  adjustmentById,
  DEFAULT_CURVE_POINTS,
  defaultParams,
  type AdjustmentId,
} from './editor-adjustments';
import type { EditorSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

/**
 * The dialog's live preview: the visible document window `rect` (doc px),
 * rendered at display resolution into `buffer` (ADR-245 Amendment 1). The
 * buffer is reused between steps; each step publishes a new wrapper.
 */
export type AdjustPreview = {
  readonly buffer: RgbaBuffer;
  readonly rect: PixelRect;
};

export type AdjustDialog = {
  readonly id: AdjustmentId;
  readonly params: Readonly<Record<string, number>>;
  /** Curves control points; null for every other adjustment. */
  readonly curvePoints: readonly CurvePoint[] | null;
  /** Preview ✓ (Photoshop): off shows the untouched document. */
  readonly previewEnabled: boolean;
  /** Latest computed preview; null until the first compute lands or off screen. */
  readonly preview: AdjustPreview | null;
  /**
   * How far a worker render of a neighbourhood filter is, 0..1; null when
   * none is pending (ADR-245 Amendment 2). The dialog shows a bar with Cancel.
   */
  readonly previewProgress: number | null;
};

type AdjustDialogState = {
  readonly dialog: AdjustDialog | null;
  readonly open: (id: AdjustmentId) => void;
  readonly setParams: (params: Readonly<Record<string, number>>) => void;
  readonly setCurvePoints: (points: readonly CurvePoint[]) => void;
  readonly setPreviewEnabled: (enabled: boolean) => void;
  readonly setPreview: (preview: AdjustPreview | null) => void;
  readonly setPreviewProgress: (progress: number | null) => void;
  /** Stop a worker render and turn Preview off, so the canvas shows the image as it is. */
  readonly cancelPreviewRender: () => void;
  /** Reset every slider to its default (the Photoshop Alt-Reset behavior). */
  readonly reset: () => void;
  readonly commit: () => void;
  readonly cancel: () => void;
};

const EMPTY_DIALOG = { previewEnabled: true, preview: null, previewProgress: null } as const;

function freshDialog(id: AdjustmentId): AdjustDialog {
  return {
    id,
    params: defaultParams(adjustmentById(id)),
    curvePoints: id === 'curves' ? DEFAULT_CURVE_POINTS : null,
    ...EMPTY_DIALOG,
  };
}

export const useAdjustDialogStore = create<AdjustDialogState>((set, get) => ({
  dialog: null,

  open: (id) => {
    const editor = useImageEditorStore.getState();
    if (editor.session === null || editor.transform !== null) return;
    const spec = adjustmentById(id);
    // Curves has no sliders but is never instant — it opens its point editor.
    if (spec.params.length === 0 && id !== 'curves') {
      useImageEditorStore.setState({ session: commitAdjustment(editor.session, id, {}) });
      return;
    }
    set({ dialog: freshDialog(id) });
  },

  setParams: (params) =>
    set((s) =>
      s.dialog === null
        ? s
        : { dialog: { ...s.dialog, params: { ...s.dialog.params, ...params } } },
    ),

  setCurvePoints: (curvePoints) =>
    set((s) => (s.dialog === null ? s : { dialog: { ...s.dialog, curvePoints } })),

  setPreviewEnabled: (previewEnabled) => {
    if (!previewEnabled) stopFilterPreview();
    set((s) =>
      s.dialog === null
        ? s
        : {
            dialog: {
              ...s.dialog,
              previewEnabled,
              previewProgress: previewEnabled ? s.dialog.previewProgress : null,
            },
          },
    );
  },

  setPreview: (preview) =>
    set((s) => (s.dialog === null ? s : { dialog: { ...s.dialog, preview } })),

  setPreviewProgress: (previewProgress) =>
    set((s) =>
      s.dialog === null || s.dialog.previewProgress === previewProgress
        ? s
        : { dialog: { ...s.dialog, previewProgress } },
    ),

  cancelPreviewRender: () => get().setPreviewEnabled(false),

  reset: () => set((s) => (s.dialog === null ? s : { dialog: freshDialog(s.dialog.id) })),

  commit: () => {
    const { dialog } = get();
    const editor = useImageEditorStore.getState();
    if (dialog === null || editor.session === null) return;
    set({ dialog: null });
    useImageEditorStore.setState({
      session: commitAdjustment(
        editor.session,
        dialog.id,
        dialog.params,
        dialog.curvePoints ?? undefined,
      ),
    });
  },

  cancel: () => set({ dialog: null }),
}));

/** The preview the canvas should draw over the document, if any. */
export function useAdjustPreview(): AdjustPreview | null {
  return useAdjustDialogStore((s) =>
    s.dialog !== null && s.dialog.previewEnabled ? s.dialog.preview : null,
  );
}

// One dialog's reused preview buffers; released when the dialog closes.
const previewCache: AdjustPreviewCache = { current: null };

/** Recompute the preview for the current dialog params and view (timer-scheduled by the dialog). */
export function refreshAdjustPreview(): void {
  const { dialog, setPreview } = useAdjustDialogStore.getState();
  const { session, view, viewportSize } = useImageEditorStore.getState();
  if (dialog === null || session === null || !dialog.previewEnabled) return;
  const win = previewWindow(session.doc, view, viewportSize, selectionBounds(session.selection));
  if (win === null) {
    stopFilterPreview();
    useAdjustDialogStore.getState().setPreviewProgress(null);
    setPreview(null);
    return;
  }
  const request = {
    id: dialog.id,
    params: dialog.params,
    curvePoints: dialog.curvePoints ?? undefined,
  };
  if (previewsInWorker(request.id, session)) {
    renderInWorker(session, request, win);
    return;
  }
  setPreview({ buffer: computeWindowPreview(previewCache, session, request, win), rect: win.rect });
}

// A neighbourhood filter on a large document (ADR-245 Amendment 2). Each
// callback first checks the step still belongs to the open dialog's session;
// a finished one always clears the bar.
function renderInWorker(session: EditorSession, request: AdjustRequest, win: PreviewWindow): void {
  const current = (): boolean =>
    useAdjustDialogStore.getState().dialog?.previewEnabled === true &&
    useImageEditorStore.getState().session === session;
  const { setPreview, setPreviewProgress } = useAdjustDialogStore.getState();
  scheduleFilterPreview(session, request, win, {
    progress: (fraction) => {
      if (current()) setPreviewProgress(Math.round(fraction * 100) / 100);
    },
    done: (filtered) => {
      setPreviewProgress(null);
      if (!current()) return;
      setPreview({
        buffer: composeFilteredWindow(previewCache, session, win, filtered),
        rect: win.rect,
      });
    },
    fallback: () => {
      setPreviewProgress(null);
      if (!current()) return;
      setPreview({
        buffer: computeWindowPreview(previewCache, session, request, win),
        rect: win.rect,
      });
    },
  });
}

useAdjustDialogStore.subscribe((state) => {
  if (state.dialog !== null) return;
  previewCache.current = null;
  stopFilterPreview();
  retireFilterPreviewWorker();
});

// A closed or different session invalidates the dialog and its preview
// buffer (the overlay itself never asks anything on close — CLAUDE.md #7).
useImageEditorStore.subscribe((state, prev) => {
  if (state.session?.objectId === prev.session?.objectId) return;
  if (useAdjustDialogStore.getState().dialog !== null) {
    useAdjustDialogStore.getState().cancel();
  }
});
