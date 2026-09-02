import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { VariableCsvImport } from './VariableCsvImport';
import { useVariableCsvImportOwner } from './use-variable-csv-import-owner';

// React's test renderer owns this documented JSDOM-only test flag; runtime narrowing cannot express it.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type CsvImportHarness = {
  readonly host: HTMLDivElement;
  readonly setCsv: ReturnType<typeof vi.fn>;
  readonly pushToast: ReturnType<typeof vi.fn>;
  readonly unmount: () => Promise<void>;
};

describe('VariableCsvImport request ownership', () => {
  it('allows only the latest CSV read to publish', async () => {
    const harness = await renderCsvImport();
    const first = deferred<string>();
    const second = deferred<string>();

    await importFile(harness, textFile('first.csv', first.promise));
    await importFile(harness, textFile('second.csv', second.promise));
    second.resolve('name\nSECOND\n');
    await settleAsyncWork();

    expect(harness.setCsv).toHaveBeenCalledOnce();
    expect(harness.setCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceName: 'second.csv', records: [['SECOND']] }),
    );

    first.resolve('name\nFIRST\n');
    await settleAsyncWork();

    expect(harness.setCsv).toHaveBeenCalledOnce();
    expect(harness.pushToast).toHaveBeenCalledOnce();
  });

  it('owns a selection dispatched synchronously by the native picker click', async () => {
    const harness = await renderCsvImport();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [textFile('immediate.csv', Promise.resolve('name\nIMMEDIATE\n'))],
      });
      this.dispatchEvent(new Event('change', { bubbles: true }));
    });
    onTestFinished(() => click.mockRestore());

    await clickImportButton(harness);
    await settleAsyncWork();

    expect(harness.setCsv).toHaveBeenCalledWith(
      expect.objectContaining({ sourceName: 'immediate.csv', records: [['IMMEDIATE']] }),
    );
  });

  it('binds overlapping picker events to their exact same-component claims', async () => {
    const harness = await renderCsvImport();

    await clickImportButton(harness);
    await clickImportButton(harness);
    const [firstInput, secondInput] = csvInputs(harness);
    if (firstInput === undefined || secondInput === undefined) {
      throw new Error('overlapping CSV picker inputs missing');
    }
    await selectInput(firstInput, textFile('first.csv', Promise.resolve('name\nFIRST\n')));
    await settleAsyncWork();
    expect(harness.setCsv).not.toHaveBeenCalled();

    await selectInput(secondInput, textFile('second.csv', Promise.resolve('name\nSECOND\n')));
    await settleAsyncWork();

    expect(harness.setCsv).toHaveBeenCalledWith(
      expect.objectContaining({ sourceName: 'second.csv', records: [['SECOND']] }),
    );
  });

  it('retires a pending read as soon as a newer picker opens', async () => {
    const harness = await renderCsvImport();
    const older = deferred<string>();

    await importFile(harness, textFile('older.csv', older.promise));
    await clickImportButton(harness);
    older.resolve('name\nOLDER\n');
    await settleAsyncWork();

    expect(harness.setCsv).not.toHaveBeenCalled();
    expect(harness.pushToast).not.toHaveBeenCalled();
  });

  it('binds picker ownership to the document that opened it', async () => {
    const harness = await renderCsvImport();
    useStore.setState({ projectDocumentEpoch: 30 });
    const pending = deferred<string>();

    await clickImportButton(harness);
    useStore.setState({ project: createProject(), projectDocumentEpoch: 31 });
    await selectFile(harness, textFile('old-document.csv', pending.promise));
    pending.resolve('name\nSTALE\n');
    await settleAsyncWork();

    expect(harness.setCsv).not.toHaveBeenCalled();
    expect(harness.pushToast).not.toHaveBeenCalled();
  });

  it('retires an older valid read when the latest CSV is malformed', async () => {
    const harness = await renderCsvImport();
    const older = deferred<string>();
    const latest = deferred<string>();

    await importFile(harness, textFile('older.csv', older.promise));
    await importFile(harness, textFile('latest.csv', latest.promise));
    latest.resolve('name,name\nA,B\n');
    await settleAsyncWork();

    expect(harness.setCsv).not.toHaveBeenCalled();
    expect(harness.pushToast).toHaveBeenCalledOnce();
    expect(harness.pushToast).toHaveBeenLastCalledWith(
      expect.stringContaining('duplicated'),
      'error',
    );

    older.resolve('name\nOLDER\n');
    await settleAsyncWork();

    expect(harness.setCsv).not.toHaveBeenCalled();
    expect(harness.pushToast).toHaveBeenCalledOnce();
  });

  it('drops completion after the initiating document is replaced', async () => {
    const harness = await renderCsvImport();
    useStore.setState({ projectDocumentEpoch: 40 });
    const pending = deferred<string>();

    await importFile(harness, textFile('old-document.csv', pending.promise));
    useStore.setState({ project: createProject(), projectDocumentEpoch: 41 });
    pending.resolve('name\nSTALE\n');
    await settleAsyncWork();

    expect(harness.setCsv).not.toHaveBeenCalled();
    expect(harness.pushToast).not.toHaveBeenCalled();
  });

  it('drops completion after the controls unmount', async () => {
    const harness = await renderCsvImport();
    const pending = deferred<string>();

    await importFile(harness, textFile('closed.csv', pending.promise));
    await harness.unmount();
    pending.resolve('name\nSTALE\n');
    await settleAsyncWork();

    expect(harness.setCsv).not.toHaveBeenCalled();
    expect(harness.pushToast).not.toHaveBeenCalled();
  });

  it('reports a current file-read failure without mutating CSV data', async () => {
    const harness = await renderCsvImport();
    const pending = deferred<string>();

    await importFile(harness, textFile('unreadable.csv', pending.promise));
    pending.reject(new Error('disk read failed'));
    await settleAsyncWork();

    expect(harness.setCsv).not.toHaveBeenCalled();
    expect(harness.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('Could not read unreadable.csv'),
      'error',
    );
  });

  it('suppresses a stale file-read failure after a newer picker opens', async () => {
    const harness = await renderCsvImport();
    const older = deferred<string>();

    await importFile(harness, textFile('older.csv', older.promise));
    await clickImportButton(harness);
    older.reject(new Error('stale disk read failed'));
    await settleAsyncWork();

    expect(harness.setCsv).not.toHaveBeenCalled();
    expect(harness.pushToast).not.toHaveBeenCalled();
  });

  it('survives StrictMode replay and permits same-document edits during a current read', async () => {
    const harness = await renderStrictCsvImport();
    useStore.setState({ projectDocumentEpoch: 70 });
    const pending = deferred<string>();

    await importFile(harness, textFile('current.csv', pending.promise));
    useStore.setState((state) => ({
      project: { ...state.project, notes: 'edited while reading' },
      projectDocumentEpoch: 70,
    }));
    pending.resolve('name\nCURRENT\n');
    await settleAsyncWork();

    expect(harness.setCsv).toHaveBeenCalledOnce();
    expect(harness.setCsv).toHaveBeenCalledWith(
      expect.objectContaining({ sourceName: 'current.csv', records: [['CURRENT']] }),
    );
    expect(harness.pushToast).toHaveBeenCalledWith('Embedded 1 CSV record(s).', 'success');
  });
});

async function renderCsvImport(): Promise<CsvImportHarness> {
  return renderCsvImportElement((component) => component);
}

async function renderStrictCsvImport(): Promise<CsvImportHarness> {
  return renderCsvImportElement((component) => <StrictMode>{component}</StrictMode>);
}

async function renderCsvImportElement(
  wrap: (component: JSX.Element) => JSX.Element,
): Promise<CsvImportHarness> {
  resetStore();
  useVariableCsvImportOwner.setState({ owner: { kind: 'idle', requestEpoch: 0 } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const setCsv = vi.fn();
  const pushToast = vi.fn();
  let isMounted = true;
  const unmount = async () => {
    if (!isMounted) return;
    isMounted = false;
    await act(async () => root.unmount());
    host.remove();
  };
  onTestFinished(unmount);
  const component = <VariableCsvImport setCsv={setCsv} pushToast={pushToast} />;
  await act(async () => root.render(wrap(component)));
  return { host, setCsv, pushToast, unmount };
}

async function importFile(harness: CsvImportHarness, file: File): Promise<void> {
  await clickImportButton(harness);
  await selectFile(harness, file);
}

async function clickImportButton(harness: CsvImportHarness): Promise<void> {
  const button = [...harness.host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Import CSV...',
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('CSV import button missing');
  await act(async () => Simulate.click(button));
}

async function selectFile(harness: CsvImportHarness, file: File): Promise<void> {
  const input = csvInputs(harness)[0];
  if (input === undefined) throw new Error('CSV input missing');
  await selectInput(input, file);
}

async function selectInput(input: HTMLInputElement, file: File): Promise<void> {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

function csvInputs(harness: CsvImportHarness): ReadonlyArray<HTMLInputElement> {
  return [...harness.host.querySelectorAll('input[aria-label="Import variable CSV"]')].filter(
    (input): input is HTMLInputElement => input instanceof HTMLInputElement,
  );
}

async function settleAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function textFile(name: string, contents: Promise<string>): File {
  // A real File cannot expose a controlled delayed text() read, so the fixture supplies that browser contract.
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
