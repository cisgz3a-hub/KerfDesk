import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { FontUsageHint } from './FontUsageHint';
import { VariableRowsPreview } from './VariableRowsPreview';
import { TextWorkerError } from './text-worker-session';
import type { DialogValues } from './use-text-dialog-fields';

const session = vi.hoisted(() => ({
  render: vi.fn(),
  missingCharacters: vi.fn(),
  release: vi.fn(),
}));
vi.mock('./use-text-worker-session', () => ({ useTextWorkerSession: () => session }));
let host: HTMLDivElement, root: Root;
const embeddedFonts: [] = [];
beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('clears a failed glyph-coverage message as soon as the text becomes empty', async () => {
  session.missingCharacters.mockRejectedValue(
    new TextWorkerError('worker unavailable', 'unavailable'),
  );
  const render = (content: string) =>
    root.render(
      <FontUsageHint
        fontKey="roboto-regular"
        embeddedFonts={embeddedFonts}
        content={content}
        variable={false}
        fontAvailable
      />,
    );
  await act(async () => render('A'));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.textContent).toContain('worker unavailable');
  await act(async () => render(''));
  expect(host.textContent).toBe('');
});

it('releases busy row layout on close and can render again after reopening', async () => {
  session.render.mockImplementation(() => new Promise(() => undefined));
  const textValues: DialogValues = {
    content: '{{serial:3}}',
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    bendDeg: 0,
    color: '#000',
    embeddedFonts,
    textBox: { mode: 'fixed', widthMm: 20, heightMm: 10, wrap: true, fit: 'none', minSizeMm: 1 },
  };
  await act(async () =>
    root.render(
      <VariableRowsPreview
        source="{{serial:3}}"
        variables={DEFAULT_PROJECT_VARIABLE_DATA}
        textValues={textValues}
      />,
    ),
  );
  const details = host.querySelector('details')!;
  await act(async () => {
    details.open = true;
    Simulate.toggle(details);
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(session.render).toHaveBeenCalledTimes(1);
  const releases = session.release.mock.calls.length;
  await act(async () => {
    details.open = false;
    Simulate.toggle(details);
  });
  expect(session.release.mock.calls.length).toBeGreaterThan(releases);
  await act(async () => {
    details.open = true;
    Simulate.toggle(details);
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(session.render).toHaveBeenCalledTimes(2);
});

it('keeps an idle row-layout worker, and its parsed font, across an edit', async () => {
  session.render.mockResolvedValue({ textBoxLayout: undefined });
  const textValues = (sizeMm: number): DialogValues => ({
    content: '{{serial:3}}',
    fontKey: 'roboto-regular',
    sizeMm,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    bendDeg: 0,
    color: '#000',
    embeddedFonts,
    textBox: { mode: 'fixed', widthMm: 20, heightMm: 10, wrap: true, fit: 'none', minSizeMm: 1 },
  });
  const show = (sizeMm: number) =>
    root.render(
      <VariableRowsPreview
        source="{{serial:3}}"
        variables={DEFAULT_PROJECT_VARIABLE_DATA}
        textValues={textValues(sizeMm)}
      />,
    );
  await act(async () => show(10));
  const details = host.querySelector('details')!;
  await act(async () => {
    details.open = true;
    Simulate.toggle(details);
  });
  // Each pass lays out the template (for its baseline) and then the row.
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(session.render).toHaveBeenCalledTimes(2);
  await act(async () => show(12));
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(session.render).toHaveBeenCalledTimes(4);
  expect(session.release).not.toHaveBeenCalled();
});
