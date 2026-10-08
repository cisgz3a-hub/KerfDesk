import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { ProductionManifestButton } from './ProductionManifestButton';
import { RetainedArraysButton } from './RetainedArraysButton';
import './ProjectSheetsBar.css';

export function ProjectSheetsBar(): JSX.Element {
  const book = useStore((state) => state.project.sheetBook);
  const switchSheet = useStore((state) => state.switchProjectSheet);
  const [open, setOpen] = useState(false);
  return (
    <div aria-label="Project sheets" className="lf-project-sheets-bar">
      <label>
        Sheet{' '}
        <select
          aria-label="Active project sheet"
          title="Open another sheet's artwork and setup; only the active sheet is output, and switching resets the current review."
          value={book?.activeId ?? 'current'}
          onChange={(event) => switchSheet(event.currentTarget.value)}
        >
          <option value={book?.activeId ?? 'current'}>{book?.activeName ?? 'Sheet 1'}</option>
          {book?.inactive.map((sheet) => (
            <option key={sheet.id} value={sheet.id}>
              {sheet.name}
            </option>
          ))}
        </select>
      </label>
      <Button onClick={() => setOpen(true)}>Manage sheets…</Button>
      <ProductionManifestButton />
      <RetainedArraysButton />
      {open ? <ProjectSheetsDialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function ProjectSheetsDialog(props: { readonly onClose: () => void }): JSX.Element {
  const state = useStore();
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const book = state.project.sheetBook;
  const productionRowOpen = state.project.productionManifest?.activeRowId !== undefined;
  const create = (duplicate: boolean | 'production-design'): void => {
    const id = state.addProjectSheet(name, duplicate);
    setStatus(
      id === null
        ? 'Give the sheet a name. Up to 100 sheets fit in one project.'
        : 'Opened the new sheet. Only the active sheet is previewed and output.',
    );
    if (id !== null) setName('');
  };
  return (
    <Dialog title="Project sheets" onClose={props.onClose} size="md">
      <p>
        Each sheet retains its artwork, machine setup, placement, selected-output scope and variable
        data. Switches reset current review and Frame ownership. Save the project to keep all sheets
        together.
      </p>
      <p>
        Duplicate active sheet keeps the current artwork, including fixed text and barcodes. When a
        production row is open, Duplicate editable design restores the run's saved editable design
        and variable settings for a new batch. Both copies start without a production run; run
        results stay on the original sheet.
      </p>
      <label>
        New sheet name
        <input
          aria-label="New sheet name"
          title="Name the blank sheet or copy that the Add or Duplicate action will create."
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <SheetCreationButtons
        disabled={name.trim() === ''}
        productionRowOpen={productionRowOpen}
        onCreate={create}
      />
      {book === undefined ? null : (
        <>
          <label>
            Active sheet name
            <input
              aria-label="Active sheet name"
              title="Rename the active sheet when you leave this field; the name is saved with the project."
              maxLength={200}
              defaultValue={book.activeName}
              key={book.activeId}
              onBlur={(event) => state.renameProjectSheet(book.activeId, event.currentTarget.value)}
            />
          </label>
          <ul>
            {book.inactive.map((sheet) => (
              <li key={sheet.id}>
                {sheet.name}{' '}
                <Button onClick={() => state.switchProjectSheet(sheet.id)}>Open</Button>
                <Button onClick={() => state.deleteInactiveProjectSheet(sheet.id)}>
                  Delete inactive sheet
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status">{status}</p>
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function SheetCreationButtons(props: {
  readonly disabled: boolean;
  readonly productionRowOpen: boolean;
  readonly onCreate: (duplicate: boolean | 'production-design') => void;
}): JSX.Element {
  return (
    <>
      <Button disabled={props.disabled} onClick={() => props.onCreate(false)}>
        Add blank sheet
      </Button>
      <Button
        disabled={props.disabled}
        title="Copy the current artwork, including any fixed production text and barcodes. The original keeps its run results."
        onClick={() => props.onCreate(true)}
      >
        Duplicate active sheet
      </Button>
      {props.productionRowOpen ? (
        <Button
          disabled={props.disabled}
          title="Start a new batch from this run's saved editable design and variable settings."
          onClick={() => props.onCreate('production-design')}
        >
          Duplicate editable design
        </Button>
      ) : null}
    </>
  );
}
