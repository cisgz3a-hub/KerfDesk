import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { CanvasVariableTextFields } from './CanvasVariableTextFields';
import { useCanvasTextVariables, type CanvasTextVariables } from './use-canvas-text-variables';
import { useTextDialogFields } from './use-text-dialog-fields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let latest: CanvasTextVariables | null;
const insert = vi.fn();

beforeEach(async () => {
  resetStore();
  clearToasts();
  insert.mockClear();
  latest = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<VariableHarness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearToasts();
  resetStore();
});

describe('canvas variable text staging', () => {
  it('uses existing defaults without introducing project data or a changed draft', async () => {
    const before = useStore.getState();
    expect(variables().variables).toEqual(DEFAULT_PROJECT_VARIABLE_DATA);
    expect(variables().changed).toBe(false);
    await act(async () =>
      variables().setSettings({ serialValue: DEFAULT_PROJECT_VARIABLE_DATA.serialValue }),
    );
    expect(variables().changed).toBe(false);
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('keeps serial, CSV and sequence changes local and discards them on cancellation', async () => {
    const before = useStore.getState();
    await enableVariableText();
    await changeNumber('Variable serial', 41);
    await importCsv('parts.csv', Promise.resolve('name\nAlpha\nBeta\n'));
    await clickButton('Next');
    expect(variables().variables).toMatchObject({
      recordIndex: 1,
      serialValue: 42,
      csv: { sourceName: 'parts.csv', records: [['Alpha'], ['Beta']] },
    });
    expect(variables().changed).toBe(true);
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().dirty).toBe(false);
    await act(async () => root.render(null));
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    await act(async () => root.render(<VariableHarness />));
    expect(variables().variables).toEqual(DEFAULT_PROJECT_VARIABLE_DATA);
    expect(variables().changed).toBe(false);
  });

  it('shares the existing wrap, previous, reset and CSV range semantics', async () => {
    await act(async () =>
      variables().setCsv({
        sourceName: 'parts.csv',
        headers: ['name'],
        records: [['A'], ['B'], ['C']],
      }),
    );
    await act(async () =>
      variables().setSettings({
        recordIndex: 2,
        serialValue: 12,
        sequence: {
          recordStartIndex: 1,
          recordEndIndex: 2,
          serialStartValue: 10,
          serialEndValue: 12,
          advanceBy: 1,
        },
      }),
    );
    await act(async () => variables().advance());
    expect(variables().variables).toMatchObject({ recordIndex: 1, serialValue: 10 });
    await act(async () => variables().retreat());
    expect(variables().variables).toMatchObject({ recordIndex: 2, serialValue: 12 });
    await act(async () => variables().reset());
    expect(variables().variables).toMatchObject({ recordIndex: 1, serialValue: 10 });
    await act(async () => variables().setCsv(undefined));
    expect(variables().variables.csv).toBeUndefined();
    expect(variables().variables.recordIndex).toBe(0);
    expect(variables().variables.sequence).toMatchObject({
      recordStartIndex: 0,
      recordEndIndex: 0,
    });
    expect(useStore.getState().project.variables).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('returns to unchanged after reverting a staged scalar setting', async () => {
    await act(async () => variables().setSettings({ serialValue: 90 }));
    expect(variables().changed).toBe(true);
    await act(async () =>
      variables().setSettings({ serialValue: DEFAULT_PROJECT_VARIABLE_DATA.serialValue }),
    );
    expect(variables().changed).toBe(false);
  });

  it('keeps CSV validation and field insertion without mutating the saved project', async () => {
    await enableVariableText();
    const before = useStore.getState().project;
    await importCsv('bad.csv', Promise.resolve('name,name\nA,B\n'));
    expect(variables().changed).toBe(false);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ variant: 'error', message: expect.stringContaining('duplicated') }),
    ]);
    await clickButton('Serial');
    expect(insert).toHaveBeenCalledWith('{{serial:4}}');
    expect(useStore.getState().project).toBe(before);
  });

  it('retires a pending CSV read when the staged controls are cancelled', async () => {
    await enableVariableText();
    let resolve!: (text: string) => void;
    const pending = new Promise<string>((yes) => {
      resolve = yes;
    });
    await importCsv('late.csv', pending);
    await act(async () => root.render(null));
    const before = useStore.getState().project;
    await act(async () => resolve('name\nLATE\n'));
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

function VariableHarness(): JSX.Element {
  const project = useStore((state) => state.project);
  latest = useCanvasTextVariables(project);
  const fields = useTextDialogFields({ mode: 'add' }, project, null);
  return <CanvasVariableTextFields fields={fields} variables={latest} onInsert={insert} />;
}

function variables(): CanvasTextVariables {
  if (latest === null) throw new Error('Variable draft missing');
  return latest;
}

async function enableVariableText(): Promise<void> {
  const toggle = host.querySelector('section[aria-label="Variable text"] input[type="checkbox"]');
  if (!(toggle instanceof HTMLInputElement)) throw new Error('Variable toggle missing');
  await act(async () => {
    toggle.checked = true;
    Simulate.change(toggle);
  });
}

async function changeNumber(label: string, value: number): Promise<void> {
  const input = host.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${label} missing`);
  await act(async () => {
    input.value = String(value);
    Simulate.change(input);
  });
}

async function clickButton(label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`${label} missing`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function importCsv(name: string, contents: Promise<string>): Promise<void> {
  await clickButton('Import CSV...');
  const input = host.querySelector('input[aria-label="Import variable CSV"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('CSV picker missing');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name, text: () => contents }],
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function clearToasts(): void {
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
}
