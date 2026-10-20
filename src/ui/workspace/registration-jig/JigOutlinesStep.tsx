import { useState } from 'react';
import { findRegistrationBoxes, updateLayer } from '../../../core/scene';
import { Button } from '../../kit';
import { reportDependencyRepairs } from '../../state/object-delete-actions';
import { RegistrationJigOutlineControls } from '../RegistrationJigOutlineControls';
import { RegistrationJigOperationSettingsEditor } from '../RegistrationJigOperationSettings';
import { deleteJigArtworkIds } from './jig-editor-artwork';
import { changeJigDraft, jigOutlinesLocked } from './jig-editor-session';
import type { JigEditorController } from './use-jig-editor';

/** Step 1: the outlines' shape, size and grid, and their laser settings. */
export function JigOutlinesStep({ editor }: { readonly editor: JigEditorController }): JSX.Element {
  const project = editor.session.draft.project;
  const boxes = findRegistrationBoxes(project.scene);
  const locked = jigOutlinesLocked(project);
  // Kept artwork from removed pieces, offered for removal until the layout
  // changes again (an Undo of the shrink brings the pieces back).
  const [leftover, setLeftover] = useState({ ids: new Set<string>(), outlines: 0 });
  const live = new Set(
    leftover.outlines === boxes.length
      ? project.scene.objects
          .filter((object) => leftover.ids.has(object.id))
          .map((object) => object.id)
      : [],
  );
  // Outline edits and undo/redo of those edits re-seed the fields from the
  // actual geometry; artwork changes leave half-typed fields alone.
  const layoutKey = JSON.stringify(boxes.map((box) => [box.id, box.spec, box.transform]));
  return (
    <>
      {locked && <JigOutlineLock onUnlock={editor.unlockOutlines} />}
      {/* Burned outlines keep their layout until Unlock outlines. */}
      <fieldset className="lf-jig-edit" disabled={locked}>
        <RegistrationJigOutlineControls
          key={layoutKey}
          scene={project.scene}
          onReplace={(spec, removed) => {
            editor.onReplaceLayout(spec);
            setLeftover({ ids: new Set(removed), outlines: spec.rows * spec.columns });
          }}
          onRemove={editor.onRemoveLayout}
        />
      </fieldset>
      {live.size > 0 && (
        <JigLeftoverArtwork
          count={live.size}
          onRemove={() => {
            let repairs: ReturnType<typeof deleteJigArtworkIds>['repairs'] = null;
            editor.setSession((current) => {
              const deletion = deleteJigArtworkIds(current, live);
              repairs = deletion.repairs;
              return deletion.session;
            });
            if (repairs !== null) reportDependencyRepairs(repairs);
            setLeftover({ ids: new Set(), outlines: 0 });
          }}
        />
      )}
      <p className="lf-jig-muted">
        Drag the outlines into place on the base. Ctrl+A selects them all.
      </p>
      <JigOutlineBurnSettings editor={editor} />
    </>
  );
}

// Shrinking the grid keeps the artwork of the removed pieces as ordinary
// artwork, which can still burn; one click removes it instead.
function JigLeftoverArtwork(props: {
  readonly count: number;
  readonly onRemove: () => void;
}): JSX.Element {
  return (
    <div className="lf-jig-lock" role="status">
      <p>
        {props.count} artwork object{props.count === 1 ? ' was' : 's were'} in removed pieces and
        stay{props.count === 1 ? 's' : ''} as ordinary artwork, which can still burn.
      </p>
      <Button
        title="Remove the artwork that was in the removed pieces; Undo brings it back"
        onClick={props.onRemove}
      >
        Remove {props.count === 1 ? 'it' : 'them'}
      </Button>
    </div>
  );
}

function JigOutlineLock(props: { readonly onUnlock: () => void }): JSX.Element {
  return (
    <div className="lf-jig-lock" role="note">
      <p>
        The outlines are locked because they are marked as burned. Moving them or changing their
        layout would misplace the artwork on the pieces.
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
