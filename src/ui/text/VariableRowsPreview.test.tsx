import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { TextWorkerError } from './text-worker-session';
import type { DialogValues } from './use-text-dialog-fields';

const UNAVAILABLE = 'The text could not be laid out in the background.';
// Like the real hook, one session for the component's lifetime.
const worker = vi.hoisted(() => {
  const render = vi.fn();
  return { render, session: { render, missingCharacters: vi.fn(), release: vi.fn() } };
});
vi.mock('./use-text-worker-session', () => ({ useTextWorkerSession: () => worker.session }));
import { VariableRowsPreview } from './VariableRowsPreview';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  worker.render.mockReset();
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

const textValues: DialogValues = {
  content: '{{csv:name}}',
  fontKey: 'roboto-regular',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  bendDeg: 0,
  color: '#000000',
  embeddedFonts: [],
  textBox: { mode: 'fixed', widthMm: 20, heightMm: 8, wrap: true, fit: 'shrink', minSizeMm: 2 },
};

it('stops after one try when the text worker cannot start, and says so on every row', async () => {
  worker.render.mockRejectedValue(new TextWorkerError(UNAVAILABLE, 'unavailable'));
  const variables = {
    ...DEFAULT_PROJECT_VARIABLE_DATA,
    csv: {
      sourceName: 'names.csv',
      headers: ['name'],
      records: Array.from({ length: 25 }, (_, index) => [`Name ${index + 1}`]),
    },
  };
  await act(async () =>
    root.render(
      <VariableRowsPreview source="{{csv:name}}" variables={variables} textValues={textValues} />,
    ),
  );
  const details = host.querySelector('details')!;
  await act(async () => {
    details.open = true;
    Simulate.toggle(details);
  });
  await vi.waitFor(() => {
    const layouts = [...host.querySelectorAll('tbody tr td:last-child')].map(
      (cell) => cell.textContent,
    );
    expect(layouts).toEqual(Array.from({ length: 25 }, () => UNAVAILABLE));
  });
  expect(worker.render).toHaveBeenCalledTimes(1);
});

// Rolling audit v7 L3-P1-4 (ADR-591 Amendment 1): the rows preview shows what burns.
it('marks a record character the font has no glyph for instead of drawing it', async () => {
  worker.session.missingCharacters.mockResolvedValue(['李']);
  const variables = {
    ...DEFAULT_PROJECT_VARIABLE_DATA,
    csv: { sourceName: 'guests.csv', headers: ['name'], records: [['Zoe'], ['Zoë 李']] },
  };
  const { textBox: _box, ...natural } = textValues;
  await act(async () =>
    root.render(
      <VariableRowsPreview source="{{csv:name}}" variables={variables} textValues={natural} />,
    ),
  );
  const details = host.querySelector('details')!;
  await act(async () => {
    details.open = true;
    Simulate.toggle(details);
  });
  await vi.waitFor(() => {
    const rows = [...host.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].slice(2).map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ['Zoe', 'Natural text size'],
      ['Zoë □', 'No 李 in this font · Natural text size'],
    ]);
  });
  expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
    '李 is not in this font',
  );
  expect(worker.session.missingCharacters).toHaveBeenCalledWith({
    fontKey: 'roboto-regular',
    embeddedFonts: [],
    content: 'Zoeë 李',
  });
});
