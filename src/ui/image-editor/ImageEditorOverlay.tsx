// The Image Studio full-screen overlay (ADR-242, flow F-L1). Fixed-inset
// above the dialog layer, registered as a modal so app shortcuts yield;
// closing (Esc / ×) keeps the session and never asks anything. Apply bakes
// the working pixels into the scene object as one project undo entry.

import { useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import type { RgbaBuffer } from '../../core/image-edit';
import { formatDuration } from '../../core/job';
import type { RasterImage } from '../../core/scene';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { useRegisterModal } from '../common/use-register-modal';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useInkTimeReadout } from './use-ink-time-readout';
import { AdjustDialogPanel } from './AdjustDialog';
import type { EditorSession } from './editor-session';
import { HistoryPanel } from './HistoryPanel';
import { ImageEditorTopBar } from './ImageEditorTopBar';
import { KerfStatus } from './KerfStatus';
import { LayersPanel } from './LayersPanel';
import { EditorCanvas } from './EditorCanvas';
import { EditorOptionsBar } from './EditorOptionsBar';
import { EditorToolStrip } from './EditorToolStrip';
import { ResizeDialogPanel } from './ResizeDialog';
import { TextDialog } from './TextDialog';
import { handleEditorKeyDown, handleEditorKeyUp } from './editor-shortcuts';
import { useImageEditorStore } from './image-editor-store';
import { useCompositeDoc } from './use-composite-doc';
import { useQuickMaskStore } from './quick-mask-store';
import { useDesignStudioStore } from '../design-studio/design-studio-store';
import { PhotoQuickActions } from './PhotoQuickActions';

export function ImageEditorOverlay(
  props: { readonly embedded?: boolean } = {},
): JSX.Element | null {
  const session = useImageEditorStore((s) => s.session);
  const isApplying = useImageEditorStore((s) => s.isApplying);
  const closeEditor = useImageEditorStore((s) => s.closeEditor);
  const undo = useImageEditorStore((s) => s.undo);
  const redo = useImageEditorStore((s) => s.redo);
  const revert = useImageEditorStore((s) => s.revert);
  const apply = useImageEditorStore((s) => s.apply);
  const applyAndTrace = useImageEditorStore((s) => s.applyAndTrace);
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const isQuickMask = useQuickMaskStore((s) => s.rubylith !== null);
  const composite = useCompositeDoc(session, session?.revision ?? -1);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const embeddedRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (props.embedded) embeddedRef.current?.focus();
  }, [props.embedded]);
  useDialogA11y(rootRef, closeEditor, { closeOnEscape: false, initialFocus: 'surface' });

  if (session === null) return null;
  const trimmed = session.history.trimmedCount;

  return (
    <div
      {...editorSurfaceProps(props.embedded, rootRef, embeddedRef)}
      aria-label={`Image Studio — ${session.sourceName}`}
      tabIndex={-1}
    >
      {props.embedded ? null : <EditorModalRegistration />}
      <ImageEditorTopBar
        session={session}
        isApplying={isApplying}
        isHistoryOpen={isHistoryOpen}
        onToggleHistory={() => setIsHistoryOpen((open) => !open)}
        embedded={props.embedded === true}
        actions={{
          undo,
          redo,
          revert,
          apply,
          // Apply & Trace hands the updated scene raster to the existing
          // trace dialog (V2 plan F) via the toolbar's openImageDialog seam.
          applyAndTrace: () =>
            applyAndTrace((id) => {
              if (props.embedded) useDesignStudioStore.getState().closeStudio();
              traceUpdatedImage(id, openImageDialog);
            }),
          close: closeEditor,
        }}
      />
      <div style={bodyStyle}>
        <EditorToolStrip />
        <div style={mainColumnStyle}>
          <EditorOptionsBar />
          <EditorCanvas composite={composite} />
          <AdjustDialogPanel />
          <ResizeDialogPanel />
          <TextDialog />
          <StatusFooter
            session={session}
            composite={composite}
            isQuickMask={isQuickMask}
            trimmed={trimmed}
          />
        </div>
        {isHistoryOpen ? (
          <div style={dockStyle}>
            <PhotoQuickActions />
            <LayersPanel />
            <HistoryPanel />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function editorSurfaceProps(
  embedded: boolean | undefined,
  ref: React.RefObject<HTMLDivElement>,
  embeddedRef: React.RefObject<HTMLDivElement>,
): HTMLAttributes<HTMLDivElement> & { readonly ref?: React.RefObject<HTMLDivElement> } {
  return embedded
    ? { ref: embeddedRef, role: 'region', style: embeddedStyle }
    : {
        ref,
        role: 'dialog',
        'aria-modal': true,
        style: overlayStyle,
        onKeyDown: handleEditorKeyDown,
        onKeyUp: handleEditorKeyUp,
      };
}

function EditorModalRegistration(): null {
  useRegisterModal();
  return null;
}

// Look the freshly-applied scene raster back up by id and hand it to the
// tracer (V2 plan F). apply() has already committed it, so the object exists.
function traceUpdatedImage(objectId: string, openImageDialog: (source: RasterImage) => void): void {
  const object = useStore
    .getState()
    .project.scene.objects.find((candidate) => candidate.id === objectId);
  if (object?.kind === 'raster-image') openImageDialog(object);
}

const dockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 252,
  minWidth: 220,
  borderLeft: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  overflow: 'auto',
};

function StatusFooter(props: {
  readonly session: EditorSession;
  readonly composite: RgbaBuffer | undefined;
  readonly isQuickMask: boolean;
  readonly trimmed: number;
}): JSX.Element {
  const { session, composite, isQuickMask, trimmed } = props;
  return (
    <footer style={statusStyle}>
      <span>
        {isQuickMask
          ? 'Quick Mask — paint the selection, Q to finish'
          : session.selection === null
            ? 'No selection'
            : 'Selection active'}
        {trimmed > 0 ? ` · ${trimmed} older history steps trimmed` : ''}
        <InkTimeStatus />
      </span>
      <KerfStatus composite={composite} />
      <span>Esc closes — session is kept · Apply commits one undo step</span>
    </footer>
  );
}

// Ink coverage + rough engrave time (V2 plan E1) — advisory only; the Job
// Review estimate stays the authority.
function InkTimeStatus(): JSX.Element | null {
  const readout = useInkTimeReadout();
  if (readout === null) return null;
  const time =
    readout.estimate.kind === 'estimated'
      ? ` · ≈ ${formatDuration(readout.estimate.seconds)} @ "${readout.estimate.layerName}"`
      : '';
  return (
    <span title="Ink coverage of the visible image, and a rough engrave time from the assigned Image-mode layer">
      {` · ink ${readout.inkPercent}%${time}`}
    </span>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  // Above the dialog layer (--lf-z-dialog: 1000) and below toasts (1100).
  zIndex: 1010,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--lf-bg-0)',
  outline: 'none',
};

const bodyStyle: React.CSSProperties = { display: 'flex', flex: 1, minHeight: 0 };
const embeddedStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  outline: 'none',
};
const mainColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  // Anchors the floating adjustment dialog to the canvas column.
  position: 'relative',
};
const statusStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: 12,
  padding: '4px 12px',
  borderTop: '1px solid var(--lf-border)',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
