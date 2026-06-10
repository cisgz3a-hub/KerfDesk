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

async function renderProbe(value: number, commit: (n: number) => void): Promise<() => Promise<void>> {
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

  it('snaps the displayed text after the debounce commit', async () => {
    const commit = vi.fn();
    const unmount = await renderProbe(1500, commit);

    await act(async () => {
      typeText('9999');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).toHaveBeenCalledWith(6000);
    expect(probe.current?.displayValue).toBe('6000');

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
