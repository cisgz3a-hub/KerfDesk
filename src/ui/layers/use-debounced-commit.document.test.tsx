import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useDebouncedCommit, type DebouncedCommit } from './use-debounced-commit';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const commit = vi.fn();
const probe: { current: DebouncedCommit | null } = { current: null };
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function Probe({
  value = 20,
  commitOnBlur = false,
}: {
  readonly value?: number;
  readonly commitOnBlur?: boolean;
}): null {
  probe.current = useDebouncedCommit({ value, parse: Number, commit, commitOnBlur });
  return null;
}

async function mount(commitOnBlur = false): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Probe commitOnBlur={commitOnBlur} />));
}

function change(value: string): void {
  const input = document.createElement('input');
  input.value = value;
  probe.current?.onChange({ target: input } as React.ChangeEvent<HTMLInputElement>);
}

function replaceDocument(replacement: 'new' | 'open'): void {
  if (replacement === 'new') useStore.getState().newProject();
  else useStore.getState().setProject(createProject());
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  commit.mockClear();
  probe.current = null;
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.useRealTimers();
  resetStore();
});

describe('debounced numeric document ownership', () => {
  it.each([20, 33])(
    'refuses an old queued timer and blur before React renders replacement value %s',
    async (replacementValue) => {
      await mount();
      await act(async () => change('14'));
      const oldField = probe.current;
      await act(async () => {
        useStore.getState().newProject();
        root?.render(<Probe value={replacementValue} />);
        // Run both old callbacks before the new epoch can reach the rendered hook.
        vi.advanceTimersByTime(300);
        oldField?.onBlur();
      });
      expect(commit).not.toHaveBeenCalled();
      expect(probe.current?.displayValue).toBe(String(replacementValue));

      await act(async () => {
        change('25');
        // A late handler from the old document cannot alter the new draft or timer.
        oldField?.onBlur();
        const input = document.createElement('input');
        input.value = '40';
        oldField?.onChange({ target: input } as React.ChangeEvent<HTMLInputElement>);
      });
      expect(probe.current?.displayValue).toBe('25');
      await act(async () => vi.advanceTimersByTime(300));
      expect(commit).toHaveBeenCalledExactlyOnceWith(25);
    },
  );

  it.each(['new', 'open'] as const)(
    '%s replaces a matching parsed draft even when the canonical value is unchanged',
    async (replacement) => {
      await mount();
      await act(async () => change('20.'));
      expect(probe.current?.displayValue).toBe('20.');
      await act(async () => replaceDocument(replacement));
      expect(probe.current?.displayValue).toBe('20');
      await act(async () => {
        vi.advanceTimersByTime(300);
        probe.current?.onBlur();
      });
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it.each(['new', 'open'] as const)(
    '%s discards a blur-only edit without blocking edits in the new document',
    async (replacement) => {
      await mount(true);
      await act(async () => change('14'));
      const oldField = probe.current;
      await act(async () => {
        replaceDocument(replacement);
        oldField?.onBlur();
      });
      expect(commit).not.toHaveBeenCalled();
      expect(probe.current?.displayValue).toBe('20');
      await act(async () => {
        change('25');
        oldField?.onBlur();
        vi.advanceTimersByTime(300);
      });
      expect(commit).not.toHaveBeenCalled();
      expect(probe.current?.displayValue).toBe('25');
      await act(async () => probe.current?.onBlur());
      expect(commit).toHaveBeenCalledExactlyOnceWith(25);
    },
  );

  it('retires invalid native and React draft errors when opening at the same numeric value', async () => {
    await mount();
    const input = document.createElement('input');
    input.value = '2e1';
    await act(async () => {
      probe.current?.onChange({ target: input } as React.ChangeEvent<HTMLInputElement>);
    });
    expect(input.validity.customError).toBe(true);
    expect(probe.current?.errorMessage).not.toBeNull();
    await act(async () => replaceDocument('open'));
    expect(probe.current?.displayValue).toBe('20');
    expect(probe.current?.errorMessage).toBeNull();
    expect(input.validity.customError).toBe(false);
    await act(async () => vi.advanceTimersByTime(300));
    expect(commit).not.toHaveBeenCalled();
  });
});
