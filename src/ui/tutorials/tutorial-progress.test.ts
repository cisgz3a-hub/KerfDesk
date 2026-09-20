import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTutorialProgress, useTutorialProgress } from './tutorial-progress';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'kerfdesk.visual-tutorials.v1';
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function ProgressHarness(): JSX.Element {
  const { progress, remember } = useTutorialProgress();
  return createElement(
    'div',
    null,
    createElement('output', null, JSON.stringify(progress)),
    createElement('button', { id: 'next', onClick: () => remember('rectangle', 1) }, 'Next'),
    createElement(
      'button',
      { id: 'finish', onClick: () => remember('rectangle', 2, true) },
      'Finish',
    ),
    createElement('button', { id: 'restart', onClick: () => remember('rectangle', 0) }, 'Restart'),
  );
}

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(createElement(ProgressHarness));
  });
}

async function click(id: string): Promise<void> {
  const button = host?.querySelector<HTMLButtonElement>(`#${id}`);
  if (button === null || button === undefined) throw new Error(`Missing progress button: ${id}`);
  await act(async () => button.click());
}

function visibleProgress(): unknown {
  return JSON.parse(host?.querySelector('output')?.textContent ?? 'null');
}

beforeEach(() => localStorage.clear());

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('tutorial progress storage', () => {
  it('starts without progress when nothing has been saved', () => {
    expect(readTutorialProgress()).toEqual({});
  });

  it.each(['{invalid', 'null', '[]', '"text"', '7', 'true'])(
    'ignores malformed or non-record storage: %s',
    (raw) => {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(readTutorialProgress()).toEqual({});
    },
  );

  it('retains valid lessons while excluding invalid stored step and completion values', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        rectangle: { step: 1, completed: false },
        trace: { step: 2, completed: true },
        negative: { step: -1, completed: false },
        fractional: { step: 1.5, completed: false },
        tooLarge: { step: 50, completed: true },
        stringStep: { step: '1', completed: false },
        missingStep: { completed: true },
        stringCompletion: { step: 1, completed: 'yes' },
        missingCompletion: { step: 1 },
        nullLesson: null,
        arrayLesson: [],
        ['x'.repeat(81)]: { step: 0, completed: true },
      }),
    );
    expect(readTutorialProgress()).toEqual({
      rectangle: { step: 1, completed: false },
      trace: { step: 2, completed: true },
    });
  });

  it('continues with no saved progress when reading local storage is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    expect(readTutorialProgress()).toEqual({});
  });

  it('persists navigation, keeps other lessons, and keeps completion after a restart', async () => {
    const trace = { step: 1, completed: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trace }));
    await mount();
    expect(visibleProgress()).toEqual({ trace });
    await click('next');
    expect(readTutorialProgress()).toEqual({ trace, rectangle: { step: 1, completed: false } });
    await click('finish');
    expect(readTutorialProgress()['rectangle']).toEqual({ step: 2, completed: true });
    await click('restart');
    const expected = { trace, rectangle: { step: 0, completed: true } };
    expect(visibleProgress()).toEqual(expected);
    expect(readTutorialProgress()).toEqual(expected);
  });

  it('keeps session navigation and completion working when storage writes are denied', async () => {
    const trace = { step: 1, completed: false };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trace }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    await mount();
    await click('next');
    expect(visibleProgress()).toEqual({ trace, rectangle: { step: 1, completed: false } });
    await click('finish');
    await click('restart');
    expect(visibleProgress()).toEqual({ trace, rectangle: { step: 0, completed: true } });
    expect(readTutorialProgress()).toEqual({ trace });
  });
});
