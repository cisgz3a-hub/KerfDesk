// The Image Studio full-screen overlay (ADR-242, flow F-L1). Fixed-inset
// above the dialog layer, registered as a modal so app shortcuts yield;
// closing (Esc / ×) keeps the session and never asks anything. Apply bakes
// the working pixels into the scene object as one project undo entry.

import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../core/job';
import { useRegisterModal } from '../common/use-register-modal';
import { applyThicken } from './editor-kerf-check';
import { useInkTimeReadout } from './use-ink-time-readout';
import { useKerfCheck } from './use-kerf-check';
import { AdjustDialogPanel } from './AdjustDialog';
import type { EditorSession } from './editor-session';
import { EditorAdjustMenus } from './EditorAdjustMenus';
import { HistoryPanel } from './HistoryPanel';
import { LayersPanel } from './LayersPanel';
import { EditorCanvas } from './EditorCanvas';
import { EditorOptionsBar } from './EditorOptionsBar';
import { EditorToolStrip } from './EditorToolStrip';
import { ResizeDialogPanel } from './ResizeDialog';
import { handleEditorKeyDown, handleEditorKeyUp } from './editor-shortcuts';
import { useImageEditorStore } from './image-editor-store';
import { useQuickMaskStore } from './quick-mask-store';

export function ImageEditorOverlay(): JSX.Element | null {
  const session = useImageEditorStore((s) => s.session);
  const isApplying = useImageEditorStore((s) => s.isApplying);
  const closeEditor = useImageEditorStore((s) => s.closeEditor);
  const undo = useImageEditorStore((s) => s.undo);
  const redo = useImageEditorStore((s) => s.redo);
  const revert = useImageEditorStore((s) => s.revert);
  const apply = useImageEditorStore((s) => s.apply);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const isQuickMask = useQuickMaskStore((s) => s.rubylith !== null);
  useRegisterModal();

  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // rAF focus override (kit-dialog convention): win the initial-focus race
    // so the editor keymap receives keys immediately.
    const frame = requestAnimationFrame(() => rootRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  if (session === null) return null;
  const trimmed = session.history.trimmedCount;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image Studio — ${session.sourceName}`}
      tabIndex={-1}
      style={overlayStyle}
      onKeyDown={handleEditorKeyDown}
      onKeyUp={handleEditorKeyUp}
    >
      <TopBar
        session={session}
        isApplying={isApplying}
        isHistoryOpen={isHistoryOpen}
        onToggleHistory={() => setIsHistoryOpen((open) => !open)}
        actions={{ undo, redo, revert, apply, close: closeEditor }}
      />
      <div style={bodyStyle}>
        <EditorToolStrip />
        <div style={mainColumnStyle}>
          <EditorOptionsBar />
          <EditorCanvas />
          <AdjustDialogPanel />
          <ResizeDialogPanel />
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
            <KerfStatus />
            <span>Esc closes — session is kept · Apply commits one undo step</span>
          </footer>
        </div>
        {isHistoryOpen ? (
          <div style={dockStyle}>
            <LayersPanel />
            <HistoryPanel />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const dockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 168,
  minWidth: 168,
  borderLeft: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  overflow: 'hidden',
};

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

// Kerf thin-stroke advisory (V2 plan E2) — a warning with its fix in place,
// never a block (rule 7).
function KerfStatus(): JSX.Element | null {
  const check = useKerfCheck();
  if (check === null || check.thinPixels === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span
        title={`Ink strokes thinner than the layer's ${check.thresholdMm} mm kerf/dot width may not survive the burn`}
      >
        ⚠ {check.thinPixels} px thinner than {check.thresholdMm} mm
      </span>
      <button
        type="button"
        className="lf-btn"
        style={{ padding: '0 8px', fontSize: 11 }}
        onClick={() => applyThicken(check)}
        title="Thicken every thin stroke out to the kerf width (one undo step)"
      >
        Thicken
      </button>
    </span>
  );
}

type TopBarActions = {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly revert: () => void;
  readonly apply: () => void;
  readonly close: () => void;
};

function TopBar(props: {
  readonly session: EditorSession;
  readonly isApplying: boolean;
  readonly isHistoryOpen: boolean;
  readonly onToggleHistory: () => void;
  readonly actions: TopBarActions;
}): JSX.Element {
  const { session, isApplying, actions } = props;
  const canUndo = session.history.undoStack.length > 0;
  const canRedo = session.history.redoStack.length > 0;
  return (
    <header style={topBarStyle}>
      <strong style={titleStyle}>
        Image Studio — {session.sourceName} ({session.doc.width}×{session.doc.height} px)
      </strong>
      <EditorAdjustMenus />
      <span style={topActionsStyle}>
        <button
          type="button"
          className={props.isHistoryOpen ? 'lf-btn' : 'lf-btn lf-btn--ghost'}
          onClick={props.onToggleHistory}
          aria-pressed={props.isHistoryOpen}
          title="Show or hide the Layers and History panels"
        >
          Panels
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={actions.undo}
          disabled={!canUndo}
          title="Undo the last editor step (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={actions.redo}
          disabled={!canRedo}
          title="Redo the last undone editor step (Ctrl+Shift+Z)"
        >
          Redo
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={actions.revert}
          disabled={!canUndo && !session.dirtySinceApply}
          title="Discard every session edit and return to the as-opened image"
        >
          Revert
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={actions.apply}
          disabled={!session.dirtySinceApply || isApplying}
          title="Bake the edits into the project image (one undo step)"
        >
          {isApplying ? 'Applying…' : 'Apply'}
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--ghost"
          onClick={actions.close}
          title="Close — the editing session is kept and resumes on reopen"
        >
          ✕
        </button>
      </span>
    </header>
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

const topBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
};

const titleStyle: React.CSSProperties = { fontSize: 14, color: 'var(--lf-text)' };
const topActionsStyle: React.CSSProperties = { display: 'inline-flex', gap: 8 };
const bodyStyle: React.CSSProperties = { display: 'flex', flex: 1, minHeight: 0 };
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
  justifyContent: 'space-between',
  gap: 12,
  padding: '4px 12px',
  borderTop: '1px solid var(--lf-border)',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
