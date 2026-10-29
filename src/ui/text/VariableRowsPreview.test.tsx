import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import type { TextBoxSettings } from '../../core/scene/text-box';
import type { TextRenderResult } from '../../core/text';
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

// Rolling audit v8 N4-P3-3 (ADR-682 Amendment 1): a record burns on the
// template's first baseline, so an accented capital can rise over the frame top.
it('says a record overflows when the template baseline lifts it over the frame top', async () => {
  // Frame renders as the worker returns them: ink top at the frame top, and
  // the first baseline that far below it. Å reaches 1.66 mm above the braces.
  const framed = (inkHeight: number, baselineY: number): TextRenderResult => ({
    paths: [],
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: inkHeight },
    anchor: { x: 40, y: baselineY },
    textBoxLayout: {
      content: '',
      sizeMm: 10,
      widthMm: 80,
      heightMm: 20,
      lineCount: 1,
      advanceWidthMm: 30,
      overflow: false,
    },
  });
  const renders: Readonly<Record<string, TextRenderResult>> = {
    '{{csv:name}}': framed(9.59, 7.8),
    Anna: framed(7.21, 7.11),
    Ågot: framed(11.54, 9.46),
  };
  worker.render.mockImplementation(async ({ content }: { content: string }) => renders[content]);
  worker.session.missingCharacters.mockResolvedValue([]);
  const variables = {
    ...DEFAULT_PROJECT_VARIABLE_DATA,
    csv: { sourceName: 'guests.csv', headers: ['name'], records: [['Anna'], ['Ågot']] },
  };
  const box: TextBoxSettings = {
    mode: 'fixed',
    widthMm: 80,
    heightMm: 20,
    wrap: true,
    fit: 'shrink',
    minSizeMm: 2,
  };
  await act(async () =>
    root.render(
      <VariableRowsPreview
        source="{{csv:name}}"
        variables={variables}
        textValues={{ ...textValues, textBox: box }}
      />,
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
    expect(layouts).toEqual(['Fits · 10.00 mm · 1 lines', 'Overflow · 10.00 mm · 1 lines']);
  });
});
