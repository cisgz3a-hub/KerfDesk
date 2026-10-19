import { useState } from 'react';
import { Button } from '../../kit';
import { RegistrationJigArtworkSizeEditor } from '../RegistrationJigArtworkSizeControls';
import { applyRegistrationJigArtworkSize } from '../../state/registration-jig-artwork-actions';
import { JigArtworkImport } from './JigArtworkImport';
import { JigTextControls } from './JigTextControls';
import { JigTraceControls } from './JigTraceControls';
import { changeJigDraft } from './jig-editor-session';
import type { JigEditorController } from './use-jig-editor';

type JigAddPanel = 'text' | 'trace' | null;

/** Step 2: put the pieces in the burned outlines, then add the artwork. One
 *  row adds it (ADR-641): a single design goes on every piece by itself. */
export function JigArtworkStep({ editor }: { readonly editor: JigEditorController }): JSX.Element {
  const [panel, setPanel] = useState<JigAddPanel>(null);
  const project = editor.session.draft.project;
  const toggle = (next: Exclude<JigAddPanel, null>): void =>
    setPanel((current) => (current === next ? null : next));
  // Selecting text opens its form for editing; the tracer stays mounted while
  // hidden, so a loaded image survives a look at the text form.
  const textOpen = panel === 'text' || selectedText(editor);
  return (
    <>
      <p className="lf-jig-muted">
        Put a blank in each burned outline and focus on the top of the pieces. Keep the base where
        it was for the outline run.
      </p>
      <div className="lf-jig-add" role="group" aria-label="Add artwork">
        <JigArtworkImport
          busy={editor.importing}
          onFiles={(files) => void editor.importFiles(files, editor.ids)}
        />
        <Button
          pressed={textOpen}
          title="Write text for the pieces; new text goes on every piece"
          onClick={() => toggle('text')}
        >
          Text
        </Button>
        <Button
          pressed={panel === 'trace'}
          title="Trace an image into lines for the pieces"
          onClick={() => toggle('trace')}
        >
          Trace image
        </Button>
      </div>
      <p className="lf-jig-muted">
        One design goes on every piece. Several files fill one piece each; you can also drop files
        on an outline.
      </p>
      {textOpen && (
        <JigTextControls
          project={project}
          selectedIds={editor.ids}
          onUpsert={editor.onUpsert}
          onBusyChange={editor.onTextBusy}
        />
      )}
      <div className="lf-jig-trace" hidden={panel !== 'trace'}>
        <JigTraceControls
          project={project}
          selectedIds={editor.ids}
          onImport={editor.onImport}
          onTraceImage={editor.onTraceImage}
          onBusyChange={editor.onTraceBusy}
        />
      </div>
      <JigSharedArtworkSize editor={editor} />
    </>
  );
}

function selectedText(editor: JigEditorController): boolean {
  if (editor.ids.size !== 1) return false;
  const [id] = editor.ids;
  return editor.session.draft.project.scene.objects.some(
    (object) => object.id === id && object.kind === 'text',
  );
}

function JigSharedArtworkSize({ editor }: { readonly editor: JigEditorController }): JSX.Element {
  return (
    <RegistrationJigArtworkSizeEditor
      scene={editor.session.draft.project.scene}
      onResize={(input) => {
        const result = applyRegistrationJigArtworkSize(
          { ...editor.session.draft, undoStack: [] },
          input,
        );
        if (result.outcome.kind === 'ok') {
          editor.setSession((current) => changeJigDraft(current, result.state));
        }
        return result.outcome;
      }}
    />
  );
}
