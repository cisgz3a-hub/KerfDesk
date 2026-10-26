import { useRef } from 'react';
import { Button, Dialog, DialogActions } from '../../kit';
import { TutorialButton } from '../../tutorials/TutorialButton';
import { useDialogA11y } from '../../common/use-dialog-a11y';
import { useRegisterModal } from '../../common/use-register-modal';
import { RegistrationJigCanvas } from './RegistrationJigCanvas';
import { JigEditorSidebar } from './JigEditorSidebar';
import { undoJigDraft } from './jig-editor-session';
import {
  handleJigEditorKey,
  isTextInput,
  useJigEditor,
  type JigEditorController,
} from './use-jig-editor';
import './registration-jig.css';

export function RegistrationJigEditor(props: { readonly onClose: () => void }): JSX.Element {
  const editor = useJigEditor(props.onClose);
  const root = useRef<HTMLDivElement>(null);
  useRegisterModal();
  // Open on the editor itself: an Enter or Space pressed on arrival must not
  // land on Close or Save. Escape in a field only leaves that field, so half-
  // typed text is never lost to a selection change; a field that applies when
  // it is left drops the value typed into it, as number fields do elsewhere.
  useDialogA11y(
    root,
    () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== root.current && isTextInput(active)) {
        root.current?.focus();
        return;
      }
      editor.onEscape();
    },
    { initialFocus: 'surface' },
  );
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Registration Jig editor"
      tabIndex={-1}
      className="lf-jig-editor"
      onKeyDown={(event) => {
        if (!editor.confirmingClose) handleJigEditorKey(event, editor.session, editor.setSession);
      }}
      onDragOver={stopDrop}
      onDrop={stopDrop}
    >
      <JigEditorHeader editor={editor} />
      {editor.captured ? (
        <p className="lf-jig-notice">
          This outline belongs to Place Board. Close this editor and use Place Board to change the
          captured board.
        </p>
      ) : (
        <div className="lf-jig-body">
          <JigEditorSidebar editor={editor} />
          <RegistrationJigCanvas
            project={editor.view}
            selectedIds={editor.ids}
            fitRequest={editor.fitRequest}
            onSelectionChange={editor.onSelect}
            onCommit={editor.onCommit}
            onDropFiles={(files, outlineId) =>
              void editor.importFiles(files, outlineId === null ? editor.ids : new Set([outlineId]))
            }
          />
        </div>
      )}
      <footer className="lf-jig-footer" role="status">
        {editor.error !== '' ? <span role="alert">{editor.error}</span> : editorStatus(editor)}
      </footer>
      {editor.confirmingClose && <JigCloseConfirm editor={editor} />}
    </div>
  );
}

function stopDrop(event: React.DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function JigEditorHeader(props: { readonly editor: JigEditorController }): JSX.Element {
  const { editor } = props;
  return (
    <header className="lf-jig-header">
      <strong>Registration Jig</strong>
      <TutorialButton tutorialId="registration" compact label="Registration jig" />
      <span className="lf-jig-muted">Edit the layout and artwork on the jig canvas</span>
      <div className="lf-jig-actions">
        <Button
          title="Undo the last jig edit (Ctrl+Z)"
          onClick={() => editor.setSession((current) => undoJigDraft(current))}
          disabled={editor.session.past.length === 0}
        >
          Undo
        </Button>
        <Button
          title="Redo the last undone jig edit (Ctrl+Y)"
          onClick={() => editor.setSession((current) => undoJigDraft(current, true))}
          disabled={editor.session.future.length === 0}
        >
          Redo
        </Button>
        <Button
          title={
            editor.dirty
              ? 'Leave the editor; asks before discarding unsaved jig edits'
              : 'Leave the editor without changing the main canvas'
          }
          onClick={editor.requestClose}
        >
          Close without saving
        </Button>
        <Button
          variant="primary"
          title={saveTitle(editor)}
          onClick={editor.save}
          disabled={!editor.canSave}
        >
          Save to canvas
        </Button>
      </div>
    </header>
  );
}

function JigCloseConfirm(props: { readonly editor: JigEditorController }): JSX.Element {
  const { editor } = props;
  return (
    <Dialog size="sm" title="Save jig changes?" onClose={editor.keepEditing}>
      <p className="lf-jig-confirm-text">
        Your jig edits are only in this editor. Save them to the canvas, or discard them and leave
        the main canvas unchanged.
      </p>
      {!editor.canSave && <p className="lf-jig-muted">{saveTitle(editor)}</p>}
      <DialogActions>
        <Button variant="primary" disabled={!editor.canSave} onClick={editor.save}>
          Save to canvas
        </Button>
        <Button variant="danger" onClick={editor.discard}>
          Discard changes
        </Button>
        <Button onClick={editor.keepEditing}>Keep editing</Button>
      </DialogActions>
    </Dialog>
  );
}

function saveTitle(editor: JigEditorController): string {
  if (editor.busy) return 'Wait for the artwork to finish preparing before saving.';
  if (editor.pendingLayout)
    return 'Apply layout in Jig layout before saving to canvas, or discard the changes.';
  return 'Put this jig on the main canvas as one undoable edit and lock its outlines';
}

function editorStatus(editor: JigEditorController): string {
  if (editor.busy) return 'Preparing artwork…';
  if (editor.pendingLayout) return 'Apply layout changes before saving to canvas.';
  const unsaved = editor.dirty ? 'Unsaved changes · ' : '';
  return editor.session.firstSave
    ? `${unsaved}First save prepares Outline only. Burn outlines, place pieces, focus on their top surface, then burn artwork. Frame and Start from the main canvas.`
    : `${unsaved}Draft only · saving keeps the current output mode. Outlines lock on the main canvas.`;
}
