import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { prepareProjectForAutosave, prepareProjectForPersistence } from '../../io/project';
import { useStore } from '../state/store';
import { VariableTextControls } from './VariableTextControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let savedState: ReturnType<typeof useStore.getState>;
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  savedState = useStore.getState();
  useStore.setState({
    project: { ...createProject(), variables: { ...DEFAULT_PROJECT_VARIABLE_DATA } },
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState(savedState, true);
});

it.each([
  { field: 'serial', value: 100, expected: 100 },
  { field: 'serial', value: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
  { field: 'serial', value: Number.MAX_SAFE_INTEGER + 1, expected: Number.MAX_SAFE_INTEGER },
  { field: 'serial', value: 10_000_000_000_000_000, expected: Number.MAX_SAFE_INTEGER },
  { field: 'serial', value: -4, expected: 0 },
  { field: 'serial', value: 8.9, expected: 8 },
  { field: 'record', value: 100, expected: 100 },
  {
    field: 'record',
    value: Number.MAX_SAFE_INTEGER + 1,
    expected: Number.MAX_SAFE_INTEGER + 1,
  },
  { field: 'record', value: 10_000_000_000_000_000, expected: Number.MAX_SAFE_INTEGER + 1 },
  { field: 'record', value: -4, expected: 1 },
])('keeps $field = $value editable and persistable', async ({ field, value, expected }) => {
  const input = requireInput(field);
  input.value = String(value);
  await act(async () => Simulate.change(input));
  await act(async () => Simulate.blur(input));

  expect(Number(input.value)).toBe(expected);
  expect(input.checkValidity()).toBe(true);
  const variables = useStore.getState().project.variables;
  expect(field === 'serial' ? variables?.serialValue : variables?.recordIndex).toBe(
    field === 'serial' ? expected : expected - 1,
  );
  expectPersistable();
});

it('retains a loaded maximum record index in its valid one-based display', async () => {
  await act(async () =>
    useStore.setState((state) => ({
      project: {
        ...state.project,
        variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, recordIndex: Number.MAX_SAFE_INTEGER },
      },
    })),
  );
  const input = requireInput('record');
  expect(Number(input.value)).toBe(Number.MAX_SAFE_INTEGER + 1);
  expect(input.checkValidity()).toBe(true);
  await act(async () => Simulate.blur(input));
  expect(useStore.getState().project.variables?.recordIndex).toBe(Number.MAX_SAFE_INTEGER);
  expectPersistable();
});

it('preserves the last valid serial while clearing a draft and permits undoing its edit', async () => {
  const original = useStore.getState().project;
  const input = requireInput('serial');
  input.value = '10000000000000000';
  await act(async () => Simulate.change(input));
  await act(async () => Simulate.blur(input));
  expect(useStore.getState().project.variables?.serialValue).toBe(Number.MAX_SAFE_INTEGER);
  expectPersistable();

  input.value = '';
  await act(async () => Simulate.change(input));
  expect(input.value).toBe('');
  expect(useStore.getState().project.variables?.serialValue).toBe(Number.MAX_SAFE_INTEGER);
  await act(async () => Simulate.blur(input));
  expectPersistable();

  await act(async () => useStore.getState().undo());
  expect(useStore.getState().project).toBe(original);
  expect(Number(input.value)).toBe(original.variables?.serialValue);
  expectPersistable();
});

function requireInput(field: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="Variable ${field}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${field} counter`);
  return input;
}

function expectPersistable(): void {
  const project = useStore.getState().project;
  expect(prepareProjectForPersistence(project)).toMatchObject({ kind: 'ok' });
  expect(prepareProjectForAutosave(project)).toMatchObject({ kind: 'ok' });
}

function Harness(): JSX.Element {
  const state = useStore();
  return (
    <VariableTextControls
      variables={state.project.variables!}
      firstColumn={undefined}
      setSettings={state.setVariableSettings}
      setCsv={state.setVariableCsv}
      advance={state.advanceVariablesManually}
      retreat={state.retreatVariablesManually}
      reset={state.resetVariablesManually}
      onInsert={vi.fn()}
      pushToast={vi.fn()}
    />
  );
}
