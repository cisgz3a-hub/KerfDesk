import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DebouncedCommit, useDebouncedCommit } from './use-debounced-commit';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Mirrors the Speed field: the store clamps to the device max feed.
const MAX_FEED = 6000;
function parseSpeed(input: string): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_FEED, Math.max(1, Math.round(n)));
}

const probe: { current: DebouncedCommit | null } = { current: null };

function Probe({ value, commit }: { value: number; commit: (n: number) => void }): null {
  probe.current = useDebouncedCommit({ value, commit, parse: parseSpeed });
  return null;
}

async function renderProbe(
  value: number,
  commit: (n: number) => void,
): Promise<() => Promise<void>> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Probe value={value} commit={commit} />);
  });
  return async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
}

function typeText(text: string): void {
  probe.current?.onChange({ target: { value: text } } as React.ChangeEvent<HTMLInputElement>);
}

beforeEach(() => {
  vi.useFakeTimers();
  probe.current = null;
});

afterEach(() => {
  vi.useRealTimers();
});

// M25 (AUDIT-2026-06-10): typing 9999 into Speed (max 6000) parsed to 6000 ===
// the committed value, so the reconcile effect never rewrote the draft — the
// field kept displaying 9999 (including after blur) while the store, G-code,
// and ETA used 6000. LightBurn fields show the value actually in force.
describe('useDebouncedCommit clamp feedback (M25)', () => {
  it('snaps the displayed text to the committed value on blur', async () => {
    const commit = vi.fn();
    const unmount = await renderProbe(1500, commit);

    await act(async () => {
      typeText('9999');
    });
    await act(async () => {
      probe.current?.onBlur();
    });

    expect(commit).toHaveBeenCalledWith(6000);
    expect(probe.current?.displayValue).toBe('6000');

    await unmount();
  });

  it('commits the clamped value on the debounce timer but leaves the visible text alone', async () => {
    const commit = vi.fn();
    const unmount = await renderProbe(1500, commit);

    await act(async () => {
      typeText('9999');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // The store gets the enforced value (F-A7 undo-batching still fires on the
    // timer)...
    expect(commit).toHaveBeenCalledWith(6000);
    // ...but the field keeps the user's in-progress text until they leave it.
    // The timer can't distinguish "done" from a mid-number reading pause, so it
    // must never rewrite the box; blur reconciles (see the test above).
    expect(probe.current?.displayValue).toBe('9999');

    await unmount();
  });

  // Bug (2026-07-16): a reading pause >=300ms mid-number let the timer commit a
  // partial value and snap the box to the clamped result under the user. Typing
  // "0.5" into a min-clamped field, pausing after "0", jumped the field to the
  // minimum and the remaining keystrokes landed in the wrong place. The timer
  // commit must touch only the store, never the draft.
  it('does not rewrite an in-progress value when the debounce fires mid-typing', async () => {
    const commit = vi.fn();
    const unmount = await renderProbe(1500, commit);

    // "0" is a transient on the way to e.g. "0.5"; parseSpeed clamps it to the
    // min (1), which differs from the current value so the commit actually fires.
    await act(async () => {
      typeText('0');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).toHaveBeenCalledWith(1);
    // The box still shows what the user typed — not the clamped "1".
    expect(probe.current?.displayValue).toBe('0');

    await unmount();
  });

  it('snaps on blur even when the clamped value equals the already-committed value', async () => {
    const commit = vi.fn();
    // Speed already at the max: typing 9999 parses to 6000 === value, so no
    // store change ever fires the reconcile effect — blur must fix the text.
    const unmount = await renderProbe(6000, commit);

    await act(async () => {
      typeText('9999');
    });
    await act(async () => {
      probe.current?.onBlur();
    });

    expect(probe.current?.displayValue).toBe('6000');

    await unmount();
  });

  it('leaves in-range typing untouched', async () => {
    const commit = vi.fn();
    const unmount = await renderProbe(1500, commit);

    await act(async () => {
      typeText('2500');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).toHaveBeenCalledWith(2500);
    expect(probe.current?.displayValue).toBe('2500');

    await unmount();
  });
});

// The operator must be able to erase the whole box to retype; parse('') returns
// a fallback number (here min 1), and committing it used to snap the field back.
describe('useDebouncedCommit clear-to-retype', () => {
  it('holds an empty field and never commits the fallback on clear', async () => {
    const commit = vi.fn();
    const unmount = await renderProbe(1500, commit);

    await act(async () => {
      typeText('');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).not.toHaveBeenCalled();
    expect(probe.current?.displayValue).toBe('');

    await unmount();
  });

  it('restores the last committed value on blur of an empty field', async () => {
    const commit = vi.fn();
    const unmount = await renderProbe(1500, commit);

    await act(async () => {
      typeText('');
    });
    await act(async () => {
      probe.current?.onBlur();
    });

    expect(commit).not.toHaveBeenCalled();
    expect(probe.current?.displayValue).toBe('1500');

    await unmount();
  });

  it('commits the fresh number typed after clearing', async () => {
    const commit = vi.fn();
    const unmount = await renderProbe(1500, commit);

    await act(async () => {
      typeText('');
    });
    await act(async () => {
      typeText('25');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).toHaveBeenCalledWith(25);
    expect(probe.current?.displayValue).toBe('25');

    await unmount();
  });
});
