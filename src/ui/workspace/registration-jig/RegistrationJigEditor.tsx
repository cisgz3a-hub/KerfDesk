import { useRef } from 'react';
import { Button } from '../../kit';
import { TutorialButton } from '../../tutorials/TutorialButton';
import { useDialogA11y } from '../../common/use-dialog-a11y';
import { useRegisterModal } from '../../common/use-register-modal';
import { RegistrationJigCanvas } from './RegistrationJigCanvas';
import { JigEditorSidebar } from './JigEditorSidebar';
import { undoJigDraft } from './jig-editor-session';
import { handleJigEditorKey, useJigEditor, type JigEditorController } from './use-jig-editor';
import './registration-jig.css';

export function RegistrationJigEditor(props: { readonly onClose: () => void }): JSX.Element {
  const editor = useJigEditor(props.onClose);
  const root = useRef<HTMLDivElement>(null);
  useRegisterModal();
  useDialogA11y(root, props.onClose);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Registration Jig editor"
      tabIndex={-1}
      className="lf-jig-editor"
      onKeyDown={(event) => handleJigEditorKey(event, editor.session, editor.setSession)}
      onDragOver={stopDrop}
      onDrop={stopDrop}
    >
      <JigEditorHeader editor={editor} onClose={props.onClose} />
      {editor.captured ? (
        <p className="lf-jig-notice">
          This outline belongs to Place Board. Close this editor and use Place Board to change the
          captured board.
        </p>
      ) : (
        <div className="lf-jig-body">
          <JigEditorSidebar editor={editor} />
          <RegistrationJigCanvas
            project={editor.session.draft.project}
            selectedIds={editor.ids}
            onSelectionChange={editor.onSelect}
            onCommit={editor.onCommit}
          />
        </div>
      )}
      <footer className="lf-jig-footer" role="status">
        {editor.error !== '' ? <span role="alert">{editor.error}</span> : editorStatus(editor)}
      </footer>
    </div>
  );
}

function stopDrop(event: React.DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function JigEditorHeader(props: {
  readonly editor: JigEditorController;
  readonly onClose: () => void;
}): JSX.Element {
  const { editor } = props;
  return (
    <header className="lf-jig-header">
      <strong>Registration Jig</strong>
      <TutorialButton tutorialId="registration" compact label="Registration jig" />
      <span className="lf-jig-muted">Edit the layout and artwork on the jig canvas</span>
      <div className="lf-jig-actions">
        <Button
          onClick={() => editor.setSession((current) => undoJigDraft(current))}
          disabled={editor.session.past.length === 0}
        >
          Undo
        </Button>
        <Button
          onClick={() => editor.setSession((current) => undoJigDraft(current, true))}
          disabled={editor.session.future.length === 0}
        >
          Redo
        </Button>
        <Button onClick={props.onClose}>Close without saving</Button>
        <Button
          variant="primary"
          onClick={editor.save}
          disabled={editor.busy || editor.pendingLayout || editor.captured}
        >
          Save to canvas
        </Button>
      </div>
    </header>
  );
}

function editorStatus(editor: JigEditorController): string {
  if (editor.busy) return 'Preparing artwork…';
  if (editor.pendingLayout) return 'Apply layout changes before saving to canvas.';
  return editor.session.firstSave
    ? 'First save prepares Outline only. Burn outlines, place pieces, focus on their top surface, then burn artwork. Frame and Start from the main canvas.'
    : 'Draft only · saving keeps the current output mode. Outlines lock on the main canvas.';
}
