import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state';
import { VariableCsvMapping } from './VariableCsvMapping';
import { VariableRowsPreview } from './VariableRowsPreview';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe('explicit CSV mapping and all-row review', () => {
  it('inserts any column and rewrites all occurrences of a mapped field', async () => {
    const insert = vi.fn(),
      change = vi.fn();
    await act(async () =>
      root.render(
        <VariableCsvMapping
          headers={['name', 'part number']}
          source="{{csv:name}} / {{csv:name}}"
          onSourceChange={change}
          onInsert={insert}
        />,
      ),
    );
    const picker = host.querySelector<HTMLSelectElement>('[aria-label="CSV column to insert"]')!;
    await act(async () => {
      picker.value = 'part number';
      Simulate.change(picker);
    });
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(parseVariableTemplateSource(insert.mock.calls[0]![0])).toMatchObject({
      ok: true,
      template: { tokens: [{ kind: 'csv', column: 'part number' }] },
    });
    const mapping = host.querySelector<HTMLSelectElement>('[aria-label="Map CSV field name"]')!;
    await act(async () => {
      mapping.value = 'part number';
      Simulate.change(mapping);
    });
    expect(parseVariableTemplateSource(change.mock.calls[0]![0])).toMatchObject({
      ok: true,
      template: {
        tokens: [
          { kind: 'csv', column: 'part number' },
          { kind: 'literal', value: ' / ' },
          { kind: 'csv', column: 'part number' },
        ],
      },
    });
  });
  it('makes the final row reachable without advancing or mutating the project', async () => {
    const variables = {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      serialValue: 40,
      csv: {
        sourceName: 'parts.csv',
        headers: ['name'],
        records: Array.from({ length: 30 }, (_, index) => [`Name ${index + 1}`]),
      },
    };
    const before = useStore.getState().project;
    await act(async () =>
      root.render(<VariableRowsPreview source="{{csv:name}}-{{serial:3}}" variables={variables} />),
    );
    expect(host.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(host.querySelector('tbody tr')?.textContent).toContain('Name 1-040');
    const next = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Next rows',
    )!;
    await act(async () => next.click());
    expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(host.querySelector('tbody tr:last-child')?.textContent).toContain('Name 30-069');
    expect(next.disabled).toBe(true);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
