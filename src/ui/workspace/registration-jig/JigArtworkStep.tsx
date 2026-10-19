import {
  findRegistrationBoxes,
  isRegistrationBox,
  sceneObjectHasVisibleLayer,
} from '../../../core/scene';
import { Button } from '../../kit';
import { RegistrationJigArtworkSizeEditor } from '../RegistrationJigArtworkSizeControls';
import { applyRegistrationJigArtworkSize } from '../../state/registration-jig-artwork-actions';
import { JigArtworkImport } from './JigArtworkImport';
import { JigTextControls } from './JigTextControls';
import { JigTraceControls } from './JigTraceControls';
import { centerJigArtwork, changeJigDraft } from './jig-editor-session';
import type { JigEditorController } from './use-jig-editor';

/** Step 2: put the pieces in the burned outlines, then add and place the
 *  artwork. Ways to add artwork come first, then placing it across the jig. */
export function JigArtworkStep({ editor }: { readonly editor: JigEditorController }): JSX.Element {
  const project = editor.session.draft.project;
  return (
    <>
      <p className="lf-jig-muted">
        Put a blank in each burned outline and focus on the top of the pieces. Keep the base where
        it was for the outline run.
      </p>
      <JigArtworkImport
        busy={editor.importing}
        onFiles={(files) => void editor.importFiles(files, editor.ids)}
      />
      <JigTextControls
        project={project}
        selectedIds={editor.ids}
        onUpsert={editor.onUpsert}
        onBusyChange={editor.onTextBusy}
      />
      <details className="lf-jig-trace" open>
        <summary title="Show or hide image tracing">Trace an image</summary>
        <JigTraceControls
          project={project}
          selectedIds={editor.ids}
          onImport={editor.onImport}
          onTraceImage={editor.onTraceImage}
          onBusyChange={editor.onTraceBusy}
        />
      </details>
      <JigCentreArtwork
        editor={editor}
        outlineCount={findRegistrationBoxes(project.scene).length}
      />
      <JigSharedArtworkSize editor={editor} />
    </>
  );
}

function JigCentreArtwork(props: {
  readonly editor: JigEditorController;
  readonly outlineCount: number;
}): JSX.Element {
  const { editor, outlineCount } = props;
  const canCenter = outlineCount > 0 && hasEditableArtworkSelection(editor);
  return (
    <div className="lf-jig-fields">
      <Button
        disabled={!canCenter}
        title={
          canCenter
            ? 'Fit the selected artwork into the first outline and copy it into every outline'
            : 'Select artwork on the jig canvas first'
        }
        onClick={() => editor.setSession(centerJigArtwork)}
      >
        {outlineCount > 1
          ? `Centre + copy artwork to all ${outlineCount}`
          : 'Centre artwork in outline'}
      </Button>
      <p className="lf-jig-muted">
        Select artwork, then centre and copy it across the jig. Shift-click selects multiple
        objects.
      </p>
    </div>
  );
}

function hasEditableArtworkSelection(editor: JigEditorController): boolean {
  const scene = editor.session.draft.project.scene;
  return scene.objects.some(
    (object) =>
      editor.ids.has(object.id) &&
      !isRegistrationBox(object) &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(scene, object),
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
