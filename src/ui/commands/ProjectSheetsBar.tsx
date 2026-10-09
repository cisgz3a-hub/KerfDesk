import { useRef, useState } from 'react';
import type { ProjectSheetBook } from '../../core/scene/project-sheets';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { ProductionManifestButton } from './ProductionManifestButton';
import { RetainedArraysButton } from './RetainedArraysButton';
import './ProjectSheetsBar.css';

type SheetTab = { readonly id: string; readonly name: string };
function currentSheets(book: ProjectSheetBook | undefined): SheetTab[] {
  return book === undefined
    ? [{ id: 'current', name: 'Sheet 1' }]
    : [{ id: book.activeId, name: book.activeName }, ...book.inactive];
}
function nextSheetName(sheets: readonly SheetTab[]): string {
  const names = new Set(sheets.map((sheet) => sheet.name));
  let number = sheets.length + 1;
  while (names.has(`Sheet ${number}`)) number += 1;
  return `Sheet ${number}`;
}

export function ProjectSheetsBar(): JSX.Element {
  const book = useStore((state) => state.project.sheetBook);
  const switchSheet = useStore((state) => state.switchProjectSheet);
  const addSheet = useStore((state) => state.addProjectSheet);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const sheets = currentSheets(book);
  const activeId = book?.activeId ?? 'current';
  const tabs = useSheetTabs(book);
  const openSheet = (id: string): void => {
    if (id === activeId) return;
    setStatus(switchSheet(id) ? '' : 'This sheet could not be opened. The active sheet was kept.');
  };
  return (
    <>
      <nav className="lf-project-sheets-bar" aria-label="Project sheets">
        <ProjectSheetTabs tabs={tabs} activeId={activeId} onOpen={openSheet} />
        <button
          className="lf-project-sheet-add"
          type="button"
          aria-label="Add blank project sheet"
          title="Add and open a blank sheet"
          disabled={sheets.length >= 100}
          onClick={() =>
            setStatus(
              addSheet(nextSheetName(sheets), false) === null
                ? 'This sheet could not be created. The active sheet was kept.'
                : '',
            )
          }
        >
          +
        </button>
        <Button
          aria-label="Manage project sheets"
          title="Rename, duplicate or remove sheets"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          Manage sheets…
        </Button>
      </nav>
      {status ? (
        <p className="lf-project-sheets-status" role="status">
          {status}
        </p>
      ) : null}
      {open ? <ProjectSheetsDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ProjectSheetsDialog(props: { readonly onClose: () => void }): JSX.Element {
  const book = useStore((state) => state.project.sheetBook);
  const productionRowOpen = useStore(
    (state) => state.project.productionManifest?.activeRowId !== undefined,
  );
  const addSheet = useStore((state) => state.addProjectSheet);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const sheets = currentSheets(book);
  const activeId = book?.activeId ?? 'current';
  const create = (duplicate: boolean | 'production-design'): void => {
    const id = addSheet(name, duplicate);
    setStatus(
      id === null
        ? 'The sheet could not be created. Use a name of up to 200 characters and no more than 100 sheets.'
        : 'Opened the new sheet.',
    );
    if (id !== null) setName('');
  };
  return (
    <Dialog
      title="Project sheets"
      onClose={props.onClose}
      size="md"
      panelClassName="lf-project-sheets-dialog"
    >
      <p>
        Each sheet keeps its artwork and job setup. Preview, Frame and output use the active sheet.
        Save the project to keep all sheets together.
      </p>
      <ul className="lf-project-sheet-list" aria-label="Sheets in this project">
        {sheets.map((sheet) => (
          <ProjectSheetRow
            key={sheet.id}
            sheet={sheet}
            active={sheet.id === activeId}
            onStatus={setStatus}
          />
        ))}
      </ul>
      <SheetCreationControls
        name={name}
        setName={setName}
        count={sheets.length}
        productionRowOpen={productionRowOpen}
        create={create}
      />
      <details className="lf-project-sheet-production">
        <summary title="Show production runs and saved placement arrays for this sheet">
          Production runs and saved arrays
        </summary>
        <div className="lf-project-sheet-actions">
          <ProductionManifestButton />
          <RetainedArraysButton />
        </div>
        <p>
          Copies start without production results. An editable design copy restores the original
          variable settings for a new batch.
        </p>
      </details>
      {status ? <p role="status">{status}</p> : null}
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function ProjectSheetRow(props: {
  readonly sheet: SheetTab;
  readonly active: boolean;
  readonly onStatus: (message: string) => void;
}): JSX.Element {
  const renameSheet = useStore((state) => state.renameProjectSheet);
  const switchSheet = useStore((state) => state.switchProjectSheet);
  const deleteSheet = useStore((state) => state.deleteInactiveProjectSheet);
  return (
    <li>
      <input
        key={`${props.sheet.id}:${props.sheet.name}`}
        aria-label={props.active ? 'Active sheet name' : `Sheet name: ${props.sheet.name}`}
        title="Rename this sheet; changes are saved with the project"
        maxLength={200}
        defaultValue={props.sheet.name}
        onBlur={(event) => {
          const name = event.currentTarget.value.trim();
          if (name === '') {
            event.currentTarget.value = props.sheet.name;
            props.onStatus('A sheet name cannot be empty.');
            return;
          }
          renameSheet(props.sheet.id, name);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.currentTarget.value = props.sheet.name;
            event.stopPropagation();
          }
        }}
      />
      {props.active ? (
        <span className="lf-project-sheet-active">Active</span>
      ) : (
        <>
          <Button
            onClick={() =>
              props.onStatus(switchSheet(props.sheet.id) ? '' : 'This sheet could not be opened.')
            }
          >
            Open
          </Button>
          <Button
            title={`Delete ${props.sheet.name}; Undo restores it`}
            onClick={() => deleteSheet(props.sheet.id)}
          >
            Delete
          </Button>
        </>
      )}
    </li>
  );
}

function useSheetTabs(book: ProjectSheetBook | undefined): SheetTab[] {
  const order = useRef<string[]>([]);
  const sheets = currentSheets(book);
  // Navigation rotates archived records; keep the visible tabs in place.
  if (book === undefined) order.current = ['current'];
  else if (order.current.includes('current'))
    order.current = order.current.map((id) =>
      id === 'current' ? (book.inactive[0]?.id ?? book.activeId) : id,
    );
  const available = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  order.current = [
    ...order.current.filter((id) => available.has(id)),
    ...sheets.map((sheet) => sheet.id).filter((id) => !order.current.includes(id)),
  ];
  return order.current.flatMap((id) => available.get(id) ?? []);
}
function ProjectSheetTabs(props: {
  readonly tabs: readonly SheetTab[];
  readonly activeId: string;
  readonly onOpen: (id: string) => void;
}): JSX.Element {
  return (
    <div className="lf-project-sheet-tabs" role="tablist" aria-label="Project sheets">
      {props.tabs.map((sheet, index) => (
        <button
          key={sheet.id}
          type="button"
          role="tab"
          id={`lf-project-sheet-tab-${sheet.id}`}
          aria-controls="lf-project-sheet-content"
          aria-selected={sheet.id === props.activeId}
          tabIndex={sheet.id === props.activeId ? 0 : -1}
          title={`${sheet.name}: open this sheet's artwork and setup`}
          onClick={() => props.onOpen(sheet.id)}
          onKeyDown={(event) => navigateSheetTabs(event, index, props.tabs, props.onOpen)}
        >
          {sheet.name}
        </button>
      ))}
    </div>
  );
}
function navigateSheetTabs(
  event: React.KeyboardEvent<HTMLButtonElement>,
  index: number,
  tabs: readonly SheetTab[],
  onOpen: (id: string) => void,
): void {
  let next: number | undefined;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  const target = tabs[next];
  if (target !== undefined) onOpen(target.id);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    [next]?.focus();
}
function SheetCreationControls(props: {
  readonly name: string;
  readonly setName: (name: string) => void;
  readonly count: number;
  readonly productionRowOpen: boolean;
  readonly create: (duplicate: boolean | 'production-design') => void;
}): JSX.Element {
  const disabled = props.name.trim() === '' || props.count >= 100;
  return (
    <fieldset className="lf-project-sheet-create">
      <legend>Add or duplicate a sheet</legend>
      <label>
        New sheet name
        <input
          aria-label="New sheet name"
          title="Name the blank sheet or copy"
          maxLength={200}
          value={props.name}
          onChange={(event) => props.setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !disabled) {
              event.preventDefault();
              props.create(false);
            }
          }}
        />
      </label>
      <div className="lf-project-sheet-actions">
        <Button disabled={disabled} onClick={() => props.create(false)}>
          Add blank sheet
        </Button>
        <Button
          disabled={disabled}
          title="Copy the current artwork; production results stay on the original sheet"
          onClick={() => props.create(true)}
        >
          Duplicate active sheet
        </Button>
        {props.productionRowOpen ? (
          <Button
            disabled={disabled}
            title="Restore this run's editable design and variable settings for a new batch"
            onClick={() => props.create('production-design')}
          >
            Duplicate editable design
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
