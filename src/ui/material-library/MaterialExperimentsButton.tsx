import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { captureArtworkExperiment } from './capture-material-experiment';
import { MaterialExperimentDialog } from './MaterialExperimentDialog';

export function MaterialExperimentsButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const library = useStore((state) => state.materialLibrary);
  const project = useStore((state) => state.project);
  const selected = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const experiment = library?.experiments?.find((record) => record.id === id);
  const create = (): void => {
    if (selected === null || additional.size > 0) return;
    const store = useStore.getState();
    if (store.materialLibrary === null) store.createLibrary(`${project.device.name} Library`);
    try {
      const record = captureArtworkExperiment(
        project,
        selected,
        `experiment-${crypto.randomUUID()}`,
        new Date().toISOString(),
      );
      const result = useStore.getState().upsertMaterialExperiment(record);
      if (result.kind === 'invalid') setStatus(result.reason);
      else setId(record.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not capture this process.');
    }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Experiments…</Button>
      {!open ? null : experiment !== undefined ? (
        <MaterialExperimentDialog
          key={experiment.id}
          experiment={experiment}
          onClose={() => setId(null)}
        />
      ) : (
        <Dialog title="Material experiments" onClose={() => setOpen(false)} size="lg">
          <p>
            Generate a Material Test to capture every cell automatically, or record a selected
            laser/CNC artwork process. Export and import evidence using Saved Libraries.
          </p>
          <Button disabled={selected === null || additional.size > 0} onClick={create}>
            Record selected artwork process
          </Button>
          <ul>
            {(library?.experiments ?? []).map((record) => (
              <li key={record.id}>
                <Button onClick={() => setId(record.id)}>
                  {record.name} · {record.material || 'Material not recorded'} ·{' '}
                  {record.cells.length} cells
                </Button>
              </li>
            ))}
          </ul>
          <p role="status">{status}</p>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
