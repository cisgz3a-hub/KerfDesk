import type { MaterialExperiment } from '../../core/material-library/material-experiment';
import { Button, Dialog, DialogActions } from '../kit';
import { ExperimentPhotoView } from './ExperimentPhotoView';
import { ExperimentCellEditor, MaterialExperimentFields } from './MaterialExperimentFields';
import { useMaterialExperimentEditor } from './use-material-experiment-editor';

export function MaterialExperimentDialog(props: {
  readonly experiment: MaterialExperiment;
  readonly onClose: () => void;
}): JSX.Element {
  const editor = useMaterialExperimentEditor(props.experiment);
  const { draft } = editor;
  return (
    <Dialog title="Material experiment" onClose={props.onClose} size="xl">
      <p>
        {draft.deviceName} · {draft.machineKind} ·{' '}
        {draft.headDescription ?? draft.profileId ?? 'Custom profile'} · {draft.createdAt}
      </p>
      <p>
        Settings are captured snapshots. Result notes and photographs record your observations; they
        do not prove a completed machine run.
      </p>
      <MaterialExperimentFields draft={draft} onChange={editor.setDraft} />
      <p>
        {draft.axes ?? 'Captured artwork process'} · {draft.cells.length} cells
      </p>
      <Button disabled={editor.busy} onClick={() => void editor.loadPhoto()}>
        {editor.busy ? 'Reading photo…' : 'Add result photo'}
      </Button>
      <ExperimentPhotoView experiment={draft} onChange={editor.setDraft} />
      <ExperimentCellEditor
        draft={draft}
        onChange={editor.setDraft}
        recipeName={editor.recipeName}
        onRecipeName={editor.setRecipeName}
        onSaveRecipe={editor.saveRecipe}
      />
      <p role="status">{editor.status}</p>
      <DialogActions>
        <Button onClick={props.onClose}>Close / discard unsaved edits</Button>
        <Button onClick={editor.exportLibrary}>Export library with evidence…</Button>
        <Button variant="primary" onClick={editor.save}>
          Save experiment
        </Button>
      </DialogActions>
    </Dialog>
  );
}
