import { useState } from 'react';
import {
  findRegistrationBoxes,
  isRegistrationBox,
  sceneObjectHasVisibleLayer,
  updateLayer,
} from '../../../core/scene';
import { Button } from '../../kit';
import { RegistrationJigOutlineControls } from '../RegistrationJigOutlineControls';
import { RegistrationJigOperationSettingsEditor } from '../RegistrationJigOperationSettings';
import { JigSelectionFields } from './JigSelectionFields';
import { RegistrationJigArtworkSizeEditor } from '../RegistrationJigArtworkSizeControls';
import { applyRegistrationJigArtworkSize } from '../../state/registration-jig-artwork-actions';
import { JigArtworkImport } from './JigArtworkImport';
import { JigTextControls } from './JigTextControls';
import { JigTraceControls } from './JigTraceControls';
import { JigArtworkSettings } from './JigArtworkSettings';
import {
  centerJigArtwork,
  changeJigDraft,
  removeJigLayout,
  replaceJigLayout,
  selectJigObjects,
} from './jig-editor-session';
import type { JigEditorController } from './use-jig-editor';

export function JigEditorSidebar({
  editor,
}: {
  readonly editor: JigEditorController;
}): JSX.Element {
  const [tab, setTab] = useState<'layout' | 'artwork'>('layout');
  const { session, setSession } = editor;
  const project = session.draft.project;
  const boxes = findRegistrationBoxes(project.scene);
  const canCenter = boxes.length > 0 && hasEditableArtworkSelection(editor);
  // Artwork changes must not discard un-applied layout fields. Outline edits
  // and undo/redo of those edits re-seed the fields from actual geometry.
  const layoutKey = JSON.stringify(boxes.map((box) => [box.id, box.spec, box.transform]));
  return (
    <aside className="lf-jig-sidebar">
      <div className="lf-jig-tabs" role="group" aria-label="Jig editor tools">
        <Button pressed={tab === 'layout'} onClick={() => setTab('layout')}>
          Jig layout
        </Button>
        <Button pressed={tab === 'artwork'} onClick={() => setTab('artwork')}>
          Artwork
        </Button>
      </div>
      <section className="lf-jig-fields" aria-label="Jig layout" hidden={tab !== 'layout'}>
        <RegistrationJigOutlineControls
          key={layoutKey}
          scene={project.scene}
          onPendingChange={editor.setPendingLayout}
          onReplace={(spec) => setSession((current) => replaceJigLayout(current, spec))}
          onRemove={() => setSession(removeJigLayout)}
        />
        <Button
          onClick={() =>
            setSession((current) => selectJigObjects(current, new Set(boxes.map((box) => box.id))))
          }
          disabled={boxes.length === 0}
        >
          Select all outlines
        </Button>
        <p className="lf-jig-muted">
          Apply layout to rebuild the grid. Drag outlines or edit the selection below to position
          them.
        </p>
        <JigOutlineBurnSettings editor={editor} />
      </section>
      <section className="lf-jig-fields" aria-label="Jig artwork" hidden={tab !== 'artwork'}>
        <JigTextControls
          project={project}
          selectedIds={editor.ids}
          onUpsert={editor.onUpsert}
          onBusyChange={editor.onTextBusy}
        />
        <JigArtworkSettings
          draft={session.draft}
          onChange={(draft) => setSession((current) => changeJigDraft(current, draft))}
        />
        <JigSharedArtworkSize editor={editor} />
        <details>
          <summary>Import artwork</summary>
          <JigArtworkImport onImport={editor.onImport} onBusyChange={editor.onImportBusy} />
        </details>
        <JigTraceControls
          project={project}
          onImport={editor.onImport}
          onBusyChange={editor.onTraceBusy}
        />
        <Button disabled={!canCenter} onClick={() => setSession(centerJigArtwork)}>
          {boxes.length > 1
            ? `Centre + copy artwork to all ${boxes.length}`
            : 'Centre artwork in outline'}
        </Button>
        <p className="lf-jig-muted">
          Select artwork, then centre and copy it across the jig. Shift-click selects multiple
          objects.
        </p>
      </section>
      <JigSelectionFields project={project} selectedIds={editor.ids} onCommit={editor.onCommit} />
    </aside>
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
