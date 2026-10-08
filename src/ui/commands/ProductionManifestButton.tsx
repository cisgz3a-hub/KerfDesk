import { useEffect, useRef, useState } from 'react';
import type {
  ProductionManifest,
  ProductionRow,
  ProductionRowStatus,
} from '../../core/scene/production-manifest';
import { usePlatform } from '../app/platform-context';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { renderVariableText } from '../text/render-variable-text';

export function ProductionManifestButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Production run…</Button>
      {open ? <ProductionManifestDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ProductionManifestDialog(props: { readonly onClose: () => void }): JSX.Element {
  const manifest = useStore((state) => state.project.productionManifest);
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState(0);
  const editor = useProductionEditor();
  const row = manifest?.rows.find((entry) => entry.id === selected);
  return (
    <Dialog title="Production run" onClose={props.onClose} size="lg">
      <p>
        A run reserves row identities, data, serials and its date once. Open a row to review its
        fixed artwork, then capture the variant. Frame and Start still use the normal job workflow.
        Results below are operator observations.
      </p>
      {manifest === undefined ? (
        <ProductionRunCreate onError={editor.message} />
      ) : (
        <>
          <ProductionRunSummary manifest={manifest} />
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Serial</th>
                <th>Data</th>
                <th>Result</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {manifest.rows.slice(page * 25, (page + 1) * 25).map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.index + 1}</td>
                  <td>{entry.serialValue}</td>
                  <td>{entry.values.join(' · ')}</td>
                  <td>{entry.status}</td>
                  <td>
                    <Button disabled={editor.busy} onClick={() => setSelected(entry.id)}>
                      Inspect row {entry.index + 1}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
            Previous rows
          </Button>
          <Button
            disabled={(page + 1) * 25 >= manifest.rows.length}
            onClick={() => setPage((value) => value + 1)}
          >
            Next rows
          </Button>
          {row === undefined ? null : (
            <ProductionRowEditor
              key={row.id}
              row={row}
              active={manifest.activeRowId === row.id}
              editor={editor}
            />
          )}
          <p>
            Completed, skipped, failed and uncertain rows are never replayed automatically. Opening
            a row is an explicit document replacement. Capture edits before changing rows; save the
            project to retain this run and its reviewed variants.
          </p>
        </>
      )}
      <p role="status">{editor.status}</p>
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function useProductionEditor() {
  const platform = usePlatform();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = useRef(0);
  useEffect(
    () => () => {
      owner.current += 1;
    },
    [],
  );
  const run = async (action: (current: () => boolean) => Promise<string>): Promise<void> => {
    const token = ++owner.current;
    const current = (): boolean => owner.current === token;
    setBusy(true);
    try {
      const result = await action(current);
      if (current()) setStatus(result);
    } catch (error) {
      if (current()) setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const openRow = (id: string): void => {
    void run(async (current) => {
      if (!(await confirmDiscardAsync(platform, 'open a production row')) || !current())
        return 'Opening cancelled.';
      return (await useStore.getState().openProductionRow(id, renderVariableText, current))
        ? 'Opened fixed row artwork. Review and Frame it before output.'
        : 'The document changed; opening was cancelled.';
    });
  };
  const capture = (): void => {
    void run(
      async (current) =>
        (await useStore
          .getState()
          .captureProductionVariant(renderVariableText, new Date(), current)) ??
        'Captured this working variant. This record does not supply a completed Frame.',
    );
  };
  return { status, busy, openRow, capture, message: setStatus };
}

function ProductionRunCreate(props: { readonly onError: (value: string) => void }): JSX.Element {
  const records = useStore((state) => state.project.variables?.csv?.records.length ?? 1);
  const [name, setName] = useState('');
  const [count, setCount] = useState(String(Math.min(500, records)));
  return (
    <div>
      <label>
        Run name
        <input
          className="lf-input"
          aria-label="Run name"
          title="Name this production allocation so its fixed rows and reviewed variants can be identified in the project."
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label>
        Rows
        <input
          className="lf-input"
          aria-label="Production rows"
          title="Reserve this many rows using the current data range and serial settings; inspect the allocation before output."
          type="number"
          min={1}
          max={500}
          value={count}
          onChange={(event) => setCount(event.currentTarget.value)}
        />
      </label>
      <Button
        disabled={name.trim() === ''}
        onClick={() =>
          props.onError(
            useStore.getState().createProductionRun(name, Number(count), new Date()) ??
              'Allocated the run. Inspect and open a row to begin.',
          )
        }
      >
        Create production run
      </Button>
      <p>
        Rows follow the configured range, Advance by and per-copy offsets. Range ends can repeat CSV
        values or serials; inspect the allocation before output.
      </p>
    </div>
  );
}

function ProductionRowEditor(props: {
  readonly row: ProductionRow;
  readonly active: boolean;
  readonly editor: ReturnType<typeof useProductionEditor>;
}): JSX.Element {
  const [status, setStatus] = useState<ProductionRowStatus>(props.row.status);
  const [notes, setNotes] = useState(props.row.notes);
  useEffect(() => {
    setStatus(props.row.status);
  }, [props.row.status]);
  useEffect(() => setNotes(props.row.notes), [props.row.notes]);
  return (
    <fieldset>
      <legend>
        Row {props.row.index + 1} · {props.row.id}
      </legend>
      <Button disabled={props.editor.busy} onClick={() => props.editor.openRow(props.row.id)}>
        Open{' '}
        {props.row.reviewedProjectJson === undefined ? 'fixed row artwork' : 'reviewed variant'}
      </Button>
      <Button
        disabled={
          !props.active || props.editor.busy || !['pending', 'reviewed'].includes(props.row.status)
        }
        onClick={props.editor.capture}
      >
        Capture working variant
      </Button>
      <p>
        {props.row.reviewedAt === undefined
          ? 'No reviewed variant recorded.'
          : `Variant captured ${new Date(props.row.reviewedAt).toLocaleString()}`}
      </p>
      <label>
        Observed result
        <select
          aria-label="Production row result"
          title="Choose the operator-observed result for this row; this record does not report controller completion."
          value={status}
          onChange={(event) => setStatus(event.currentTarget.value as ProductionRowStatus)}
        >
          {(['pending', 'reviewed', 'completed', 'skipped', 'failed', 'uncertain'] as const).map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
      </label>
      <label>
        Result notes
        <textarea
          className="lf-input"
          aria-label="Production result notes"
          title="Describe this row's observed material result, uncertainty or next step before recording it."
          maxLength={10_000}
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
        />
      </label>
      <Button
        disabled={props.editor.busy}
        onClick={() =>
          props.editor.message(
            useStore.getState().recordProductionResult(props.row.id, status, notes, new Date()) ??
              'Recorded the observed result. No record or serial cursor was advanced.',
          )
        }
      >
        Record result
      </Button>
    </fieldset>
  );
}

function ProductionRunSummary({
  manifest,
}: {
  readonly manifest: ProductionManifest;
}): JSX.Element {
  return (
    <>
      <h3>{manifest.name}</h3>
      <p>
        {manifest.rows.length} rows · captured {new Date(manifest.frozenAt).toLocaleString()} ·
        active row{' '}
        {manifest.rows.find((entry) => entry.id === manifest.activeRowId)?.index === undefined
          ? 'none'
          : (manifest.rows.find((entry) => entry.id === manifest.activeRowId)?.index ?? 0) + 1}
      </p>
    </>
  );
}
