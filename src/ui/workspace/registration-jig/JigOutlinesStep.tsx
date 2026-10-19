import { findRegistrationBoxes, updateLayer } from '../../../core/scene';
import { Button } from '../../kit';
import { RegistrationJigOutlineControls } from '../RegistrationJigOutlineControls';
import { RegistrationJigOperationSettingsEditor } from '../RegistrationJigOperationSettings';
import { changeJigDraft, jigOutlinesLocked, selectJigObjects } from './jig-editor-session';
import type { JigEditorController } from './use-jig-editor';

/** Step 1: the outlines' shape, size and grid, and their laser settings. */
export function JigOutlinesStep({ editor }: { readonly editor: JigEditorController }): JSX.Element {
  const { setSession } = editor;
  const project = editor.session.draft.project;
  const boxes = findRegistrationBoxes(project.scene);
  const locked = jigOutlinesLocked(project);
  // Artwork changes must not discard un-applied layout fields. Outline edits
  // and undo/redo of those edits re-seed the fields from actual geometry.
  const layoutKey = JSON.stringify(boxes.map((box) => [box.id, box.spec, box.transform]));
  return (
    <>
      {locked && <JigOutlineLock onUnlock={editor.unlockOutlines} />}
      <RegistrationJigOutlineControls
        key={layoutKey}
        scene={project.scene}
        onPendingChange={editor.setPendingLayout}
        onReplace={editor.onReplaceLayout}
        onRemove={editor.onRemoveLayout}
      />
      <Button
        title="Select every outline to move the whole jig set together"
        onClick={() =>
          setSession((current) => selectJigObjects(current, new Set(boxes.map((box) => box.id))))
        }
        disabled={boxes.length === 0 || locked}
      >
        Select all outlines
      </Button>
      <p className="lf-jig-muted">
        Apply layout to rebuild the grid. Drag outlines or edit the selection below to position
        them.
      </p>
      <JigOutlineBurnSettings editor={editor} />
    </>
  );
}

function JigOutlineLock(props: { readonly onUnlock: () => void }): JSX.Element {
  return (
    <div className="lf-jig-lock" role="note">
      <p>
        The outlines are locked because they are marked as burned. Moving them would misplace the
        artwork on the pieces.
      </p>
      <Button
        title="Allow the outlines to be dragged and resized again until you leave the jig page"
        onClick={props.onUnlock}
      >
        Unlock outlines
      </Button>
    </div>
  );
}

function JigOutlineBurnSettings({
  editor,
}: {
  readonly editor: JigEditorController;
}): JSX.Element | null {
  if (editor.session.draft.project.machine?.kind === 'cnc') return null;
  return (
    <RegistrationJigOperationSettingsEditor
      scene={editor.session.draft.project.scene}
      onChange={(id, patch) =>
        editor.setSession((current) => {
          const project = current.draft.project;
          if (!project.scene.layers.some((layer) => layer.id === id)) return current;
          return changeJigDraft(current, {
            project: { ...project, scene: updateLayer(project.scene, id, patch) },
          });
        })
      }
    />
  );
}
