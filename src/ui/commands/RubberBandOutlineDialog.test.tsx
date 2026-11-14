// The Rubber-Band Outline dialog shows the operation the outline is cut with,
// names what it will not copy, and adds the outline on the chosen operation
// (ADR-480 Amendment 7).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import {
  addedOutline,
  laserProject,
  lineOperation,
  selectInOrder,
  square,
  vector,
} from '../state/rubber-band-outline-test-helpers';
import { resetStore } from '../state/test-helpers';
import {
  openRubberBandOutlineDialog,
  RubberBandOutlineDialogHost,
} from './RubberBandOutlineDialog';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('lists the Line operations and the new Outline, and adds the outline on the chosen one', async () => {
  const project = laserProject(
    [
      vector('engraving', [square(0, 0, 10)], 'fill'),
      vector('guide', [square(20, 0, 10)], 'guide'),
      vector('part', [square(40, 0, 10)], 'cut'),
    ],
    [
      lineOperation('fill', 30, 3000, { mode: 'fill' }),
      lineOperation('guide', 10, 4000, { output: false }),
      lineOperation('cut', 90, 300),
    ],
  );
  selectInOrder(project, ['engraving', 'guide', 'part']);

  await act(async () => {
    root.render(<RubberBandOutlineDialogHost />);
    openRubberBandOutlineDialog();
  });

  const select = host.ownerDocument.querySelector('select') as HTMLSelectElement;
  expect([...select.options].map((option) => option.textContent)).toEqual([
    'guide (Line, output off)',
    'cut (Line)',
    'New operation “Outline” (Line)',
  ]);
  expect(select.value).toBe('cut');
  expect(host.ownerDocument.body.textContent).toContain('Not offered: “fill”.');

  await act(async () => {
    select.value = 'guide';
    Simulate.change(select);
  });
  expect(host.ownerDocument.querySelector('[role="alert"]')?.textContent).toContain(
    'output is off',
  );

  const form = host.ownerDocument.querySelector('form') as HTMLFormElement;
  await act(async () => {
    select.value = 'new-outline-operation';
    Simulate.change(select);
  });
  await act(async () => {
    Simulate.submit(form);
  });

  expect(addedOutline(project).operation.name).toBe('Outline');
  expect(useStore.getState().undoStack).toHaveLength(1);
  expect(host.ownerDocument.querySelector('form')).toBeNull();
});
