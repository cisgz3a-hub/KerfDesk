import { useState } from 'react';
import {
  findRegistrationBoxes,
  isRegistrationBox,
  sceneObjectHasVisibleLayer,
} from '../../../core/scene';
import { Button } from '../../kit';
import { RegistrationJigOutlineControls } from '../RegistrationJigOutlineControls';
import { JigSelectionFields } from './JigSelectionFields';
import { RegistrationJigArtworkSizeEditor } from '../RegistrationJigArtworkSizeControls';
import { applyRegistrationJigArtworkSize } from '../../state/registration-jig-artwork-actions';
import { JigArtworkImport } from './JigArtworkImport';
import { JigTextControls } from './JigTextControls';
import { JigTraceControls } from './JigTraceControls';
import {
  centerJigArtwork,
  changeJigDraft,
  jigOutlinesLocked,
  selectJigObjects,
  unlockJigOutlines,
} from './jig-editor-session';
import type { JigEditorController } from './use-jig-editor';

export function JigEditorSidebar({
  editor,
}: {
  readonly editor: JigEditorController;
}): JSX.Element {
  // A new jig starts with its layout; an existing one usually needs artwork next.
  const [tab, setTab] = useState<JigEditorTab>(() =>
    editor.session.firstSave ? 'layout' : 'artwork',
  );
  const project = editor.view;
  return (
    <aside className="lf-jig-sidebar">
      <JigEditorTabs tab={tab} pendingLayout={editor.pendingLayout} onChange={setTab} />
      <JigLayoutSection editor={editor} hidden={tab !== 'layout'} />
      <JigArtworkSection editor={editor} hidden={tab !== 'artwork'} />
      <JigSelectionFields project={project} selectedIds={editor.ids} onCommit={editor.onCommit} />
    </aside>
  );
}

type JigEditorTab = 'layout' | 'artwork';

function JigEditorTabs(props: {
  readonly tab: JigEditorTab;
  readonly pendingLayout: boolean;
  readonly onChange: (tab: JigEditorTab) => void;
}): JSX.Element {
  return (
    <div className="lf-jig-tabs" role="group" aria-label="Jig editor tools">
      <Button
        pressed={props.tab === 'layout'}
        title={
          props.pendingLayout
            ? 'Jig layout has field changes that are not applied yet'
            : 'Outline shape, size and grid'
        }
        onClick={() => props.onChange('layout')}
      >
        {props.pendingLayout ? 'Jig layout •' : 'Jig layout'}
      </Button>
      <Button
        pressed={props.tab === 'artwork'}
        title="Add, place and set up the artwork burned on each piece"
        onClick={() => props.onChange('artwork')}
      >
        Artwork
      </Button>
    </div>
  );
}

function JigLayoutSection(props: {
  readonly editor: JigEditorController;
  readonly hidden: boolean;
}): JSX.Element {
  const { editor } = props;
  const { setSession } = editor;
  const project = editor.view;
  const boxes = findRegistrationBoxes(project.scene);
  const locked = jigOutlinesLocked(project);
  // Artwork changes must not discard un-applied layout fields. Outline edits
  // and undo/redo of those edits re-seed the fields from actual geometry.
  const layoutKey = JSON.stringify(boxes.map((box) => [box.id, box.spec, box.transform]));
  return (
    <section className="lf-jig-fields" aria-label="Jig layout" hidden={props.hidden}>
      {locked && <JigOutlineLock onUnlock={() => setSession(unlockJigOutlines)} />}
      <RegistrationJigOutlineControls
        key={layoutKey}
        // The whole draft, so the layout's capacity check counts hidden artwork too.
        scene={editor.session.draft.project.scene}
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
      <JigBurnSettingsNote />
    </section>
  );
}

// Ways to add artwork first, then placing it across the jig, then its settings.
function JigArtworkSection(props: {
  readonly editor: JigEditorController;
  readonly hidden: boolean;
}): JSX.Element {
  const { editor } = props;
  const project = editor.view;
  return (
    <section className="lf-jig-fields" aria-label="Jig artwork" hidden={props.hidden}>
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
      <JigBurnSettingsNote />
    </section>
  );
}

function JigOutlineLock(props: { readonly onUnlock: () => void }): JSX.Element {
  return (
    <div className="lf-jig-lock" role="note">
      <p>
        Outlines are locked because Artwork only is selected, so they may already be burned. Moving
        them would misplace the artwork on the pieces.
      </p>
      <Button
        title="Allow the outlines to be dragged and resized again; Undo locks them again"
        onClick={props.onUnlock}
      >
        Unlock outlines
      </Button>
    </div>
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
      scene={editor.view.scene}
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

// The jig keeps burn settings out of the way (ADR-652): each burn uses its
// operation's current settings, which Job Review shows and edits before every Start.
function JigBurnSettingsNote(): JSX.Element {
  return (
    <p className="lf-jig-muted">
      Burns use each operation’s current settings; new artwork starts at the standard ones. Job
      Review shows them after Frame, and Edit there changes them.
    </p>
  );
}
