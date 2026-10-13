import type { EditorSession } from './editor-session';
import { EditorAdjustMenus } from './EditorAdjustMenus';
import { TutorialButton } from '../tutorials/TutorialButton';
import { useImageEditorStore } from './image-editor-store';
import { Icon } from '../kit/icons';

export type ImageEditorTopBarActions = {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly revert: () => void;
  readonly apply: () => void;
  readonly applyAndTrace: () => void;
  readonly close: () => void;
};

/** Render the wrapping, session-wide Image Studio action bar. */
export function ImageEditorTopBar(props: {
  readonly session: EditorSession;
  readonly isApplying: boolean;
  readonly isHistoryOpen: boolean;
  readonly onToggleHistory: () => void;
  readonly actions: ImageEditorTopBarActions;
  readonly embedded?: boolean;
}): JSX.Element {
  const canUndo = props.session.history.undoStack.length > 0;
  const canRedo = props.session.history.redoStack.length > 0;
  return (
    <header style={topBarStyle} aria-label="Image Studio actions">
      <strong style={titleStyle}>
        {props.embedded ? 'Photo' : 'Image Studio'} — {props.session.sourceName} (
        {props.session.doc.width}×{props.session.doc.height} px)
      </strong>
      <EditorAdjustMenus />
      <span style={topActionsStyle}>
        <PhotoViewButtons />
        <TutorialButton tutorialId="image-studio" />
        <button
          type="button"
          className={props.isHistoryOpen ? 'lf-btn' : 'lf-btn lf-btn--ghost'}
          onClick={props.onToggleHistory}
          aria-pressed={props.isHistoryOpen}
          title="Show or hide the Layers and History panels"
        >
          Panels
        </button>
        <ActionButtons
          session={props.session}
          isApplying={props.isApplying}
          canUndo={canUndo}
          canRedo={canRedo}
          actions={props.actions}
          embedded={props.embedded === true}
        />
      </span>
    </header>
  );
}

function PhotoViewButtons(): JSX.Element {
  const setView = useImageEditorStore((s) => s.setView);
  const zoomTo100 = useImageEditorStore((s) => s.zoomTo100);
  return (
    <>
      <button
        type="button"
        className="lf-btn"
        title="Fit the whole photo in the canvas (Ctrl+0)"
        onClick={() => setView(null)}
      >
        Fit photo
      </button>
      <button
        type="button"
        className="lf-btn"
        title="Show one image pixel per screen pixel (Ctrl+1)"
        onClick={zoomTo100}
      >
        100%
      </button>
    </>
  );
}

function ActionButtons(props: {
  readonly session: EditorSession;
  readonly isApplying: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly actions: ImageEditorTopBarActions;
  readonly embedded?: boolean;
}): JSX.Element {
  const applyDisabled = !props.session.dirtySinceApply || props.isApplying;
  return (
    <>
      <button
        type="button"
        className="lf-btn"
        onClick={props.actions.undo}
        disabled={!props.canUndo}
        title="Undo the last editor step (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={props.actions.redo}
        disabled={!props.canRedo}
        title="Redo the last undone editor step (Ctrl+Shift+Z)"
      >
        Redo
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={props.actions.revert}
        disabled={!props.canUndo && !props.session.dirtySinceApply}
        title="Discard every session edit and return to the as-opened image"
      >
        Revert
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--primary"
        onClick={props.actions.apply}
        disabled={applyDisabled}
        title="Bake the edits into the project image (one undo step)"
      >
        {props.isApplying ? 'Applying…' : 'Apply'}
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={props.actions.applyAndTrace}
        disabled={props.isApplying}
        title="Apply pending edits if needed, then open the tracer"
      >
        Apply &amp; Trace
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        onClick={props.actions.close}
        title="Close — the editing session is kept and resumes on reopen"
        aria-label={props.embedded ? 'Back to photos' : 'Close Image Studio'}
      >
        {props.embedded ? 'Back to photos' : <Icon name="close" size={18} />}
      </button>
    </>
  );
}

const topBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
};

const titleStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: 14,
  color: 'var(--lf-text)',
};

const topActionsStyle: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: 8,
};
