import { act, createRef, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { VariableTextControls } from './VariableTextControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let setCsv = vi.fn();
let pushToast = vi.fn();

beforeEach(() => {
  resetStore();
  setCsv = vi.fn();
  pushToast = vi.fn();
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('VariableTextControls CSV request ownership', () => {
  it('allows only the latest CSV read to publish', async () => {
    await renderControls();
    const first = deferred<string>();
    const second = deferred<string>();

    await importFile(textFile('first.csv', first.promise));
    await importFile(textFile('second.csv', second.promise));
    second.resolve('name\nSECOND\n');
    await settleAsyncWork();

    expect(setCsv).toHaveBeenCalledOnce();
    expect(setCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceName: 'second.csv', records: [['SECOND']] }),
    );

    first.resolve('name\nFIRST\n');
    await settleAsyncWork();

    expect(setCsv).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledOnce();
  });

  it('retires a pending read as soon as a newer picker opens', async () => {
    await renderControls();
    const older = deferred<string>();

    await importFile(textFile('older.csv', older.promise));
    await clickImportButton();
    older.resolve('name\nOLDER\n');
    await settleAsyncWork();

    expect(setCsv).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('binds picker ownership to the document that opened it', async () => {
    useStore.setState({ projectDocumentEpoch: 30 });
    await renderControls();
    const pending = deferred<string>();

    await clickImportButton();
    useStore.setState({ project: createProject(), projectDocumentEpoch: 31 });
    await selectFile(textFile('old-document.csv', pending.promise));
    pending.resolve('name\nSTALE\n');
    await settleAsyncWork();

    expect(setCsv).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('retires an older valid read when the latest CSV is malformed', async () => {
    await renderControls();
    const older = deferred<string>();
    const latest = deferred<string>();

    await importFile(textFile('older.csv', older.promise));
    await importFile(textFile('latest.csv', latest.promise));
    latest.resolve('name,name\nA,B\n');
    await settleAsyncWork();

    expect(setCsv).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenLastCalledWith(expect.stringContaining('duplicated'), 'error');

    older.resolve('name\nOLDER\n');
    await settleAsyncWork();

    expect(setCsv).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledOnce();
  });

  it('drops completion after the initiating document is replaced', async () => {
    useStore.setState({ projectDocumentEpoch: 40 });
    await renderControls();
    const pending = deferred<string>();

    await importFile(textFile('old-document.csv', pending.promise));
    useStore.setState({ project: createProject(), projectDocumentEpoch: 41 });
    pending.resolve('name\nSTALE\n');
    await settleAsyncWork();

    expect(setCsv).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('drops completion after the controls unmount', async () => {
    await renderControls();
    const pending = deferred<string>();

    await importFile(textFile('closed.csv', pending.promise));
    await act(async () => root?.unmount());
    root = null;
    pending.resolve('name\nSTALE\n');
    await settleAsyncWork();

    expect(setCsv).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('reports a current file-read failure without mutating CSV data', async () => {
    await renderControls();
    const pending = deferred<string>();

    await importFile(textFile('unreadable.csv', pending.promise));
    pending.reject(new Error('disk read failed'));
    await settleAsyncWork();

    expect(setCsv).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringContaining('Could not read unreadable.csv'),
      'error',
    );
  });

  it('suppresses a stale file-read failure after a newer picker opens', async () => {
    await renderControls();
    const older = deferred<string>();

    await importFile(textFile('older.csv', older.promise));
    await clickImportButton();
    older.reject(new Error('stale disk read failed'));
    await settleAsyncWork();

    expect(setCsv).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('survives StrictMode replay and permits same-document edits during a current read', async () => {
    useStore.setState({ projectDocumentEpoch: 70 });
    await renderControls(true);
    const pending = deferred<string>();

    await importFile(textFile('current.csv', pending.promise));
    useStore.setState((state) => ({
      project: { ...state.project, notes: 'edited while reading' },
      projectDocumentEpoch: 70,
    }));
    pending.resolve('name\nCURRENT\n');
    await settleAsyncWork();

    expect(setCsv).toHaveBeenCalledOnce();
    expect(setCsv).toHaveBeenCalledWith(
      expect.objectContaining({ sourceName: 'current.csv', records: [['CURRENT']] }),
    );
    expect(pushToast).toHaveBeenCalledWith('Embedded 1 CSV record(s).', 'success');
  });
});

async function renderControls(strictMode = false): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const controls = (
    <VariableTextControls
      variables={DEFAULT_PROJECT_VARIABLE_DATA}
      inputRef={createRef<HTMLInputElement>()}
      firstColumn={undefined}
      onInsert={vi.fn()}
      setCsv={setCsv}
      setSettings={vi.fn()}
      advance={vi.fn()}
      retreat={vi.fn()}
      reset={vi.fn()}
      pushToast={pushToast}
    />
  );
  await act(async () => root?.render(strictMode ? <StrictMode>{controls}</StrictMode> : controls));
}

async function importFile(file: File): Promise<void> {
  await clickImportButton();
  await selectFile(file);
}

async function clickImportButton(): Promise<void> {
  const button = [...(host?.querySelectorAll('button') ?? [])].find(
    (candidate) => candidate.textContent === 'Import CSV...',
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('CSV import button missing');
  await act(async () => Simulate.click(button));
}

async function selectFile(file: File): Promise<void> {
  const input = host?.querySelector('input[aria-label="Import variable CSV"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('CSV input missing');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => Simulate.change(input));
}

async function settleAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function textFile(name: string, contents: Promise<string>): File {
  return { name, text: () => contents } as File;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
