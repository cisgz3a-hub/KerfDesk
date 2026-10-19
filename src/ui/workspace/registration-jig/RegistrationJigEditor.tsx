import { useEffect, useRef } from 'react';
import { Button } from '../../kit';
import { TutorialButton } from '../../tutorials/TutorialButton';
import { RegistrationJigCanvas } from './RegistrationJigCanvas';
import { JigEditorSidebar } from './JigEditorSidebar';
import { handleJigEditorKey, useJigEditor, type JigEditorController } from './use-jig-editor';
import './registration-jig.css';

/**
 * Jig mode (ADR-634): the jig page takes the place of the main canvas while the
 * machine panel stays docked beside it, so the whole job, from laying out the
 * outlines to the last artwork burn, happens here. Edits go straight into the
 * open project with the ordinary Undo; there is nothing to save or discard.
 */
export function RegistrationJigEditor(props: { readonly onClose: () => void }): JSX.Element {
  const editor = useJigEditor(props.onClose);
  const root = useRef<HTMLDivElement>(null);
  // Open on the page itself, so canvas keys reach it straight away.
  useEffect(() => root.current?.focus(), []);
  return (
    <div
      ref={root}
      role="region"
      aria-label="Registration Jig"
      tabIndex={-1}
      className="lf-jig-editor"
      onKeyDown={(event) => handleJigEditorKey(event, editor)}
      onDragOver={stopDrop}
      onDrop={stopDrop}
    >
      <JigEditorHeader editor={editor} />
      {editor.captured ? (
        <p className="lf-jig-notice">
          This outline belongs to Place Board. Choose Done and use Place Board to change the
          captured board.
        </p>
      ) : (
        <div className="lf-jig-body">
          <JigEditorSidebar editor={editor} />
          <RegistrationJigCanvas
            project={editor.session.draft.project}
            selectedIds={editor.ids}
            fitRequest={editor.fitRequest}
            readOnly={editor.readOnly}
            onSelectionChange={editor.onSelect}
            onCommit={editor.onCommit}
            onDropFiles={(files, outlineId) =>
              void editor.importFiles(files, outlineId === null ? editor.ids : new Set([outlineId]))
            }
          />
        </div>
      )}
      <footer className="lf-jig-footer" role="status">
        {editorStatus(editor)}
      </footer>
    </div>
  );
}

function stopDrop(event: React.DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function JigEditorHeader(props: { readonly editor: JigEditorController }): JSX.Element {
  return (
    <header className="lf-jig-header">
      <strong>Registration Jig</strong>
      <TutorialButton tutorialId="registration" compact label="Registration jig" />
      <div className="lf-jig-actions">
        <Button
          variant="primary"
          title="Go back to the main canvas. Your jig is already part of the project."
          onClick={props.editor.done}
        >
          Done
        </Button>
      </div>
    </header>
  );
}

function editorStatus(editor: JigEditorController): string {
  if (editor.busy) return 'Preparing artwork…';
  if (editor.readOnly) return 'The machine is running. Editing resumes when it stops.';
  switch (editor.runPhase) {
    case 'outlines':
      return 'Next burn: the outlines, on the empty base.';
    case 'artwork':
      return 'Next burn: the artwork, on the pieces placed in the burned outlines.';
    case 'both':
      return 'The outlines and the artwork are both set to burn. Choose one run in step 1 or 3.';
    case 'none':
      return 'Add an outline in step 1.';
  }
}
