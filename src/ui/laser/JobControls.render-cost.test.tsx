// The machine rail's setup row used to subscribe to BOTH stores whole, so a
// mousemove (setCursorMm) and every write the 250 ms status poll makes re-ran
// the framed-run readiness comparison. Counting that comparison is the cheapest
// honest proxy for "did the setup row re-render".

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import type * as FramedRunReadiness from './framed-run-readiness';
import { JobControls } from './JobControls';

const counter = vi.hoisted(() => ({ checks: 0 }));

vi.mock('./framed-run-readiness', async (importOriginal) => {
  const actual = await importOriginal<typeof FramedRunReadiness>();
  return {
    ...actual,
    framedRunReadinessIssue: (
      ...args: Parameters<typeof actual.framedRunReadinessIssue>
    ): string | null => {
      counter.checks += 1;
      return actual.framedRunReadinessIssue(...args);
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  counter.checks = 0;
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
});

describe('JobControls setup-row store subscriptions', () => {
  it('does not re-check framed-run readiness on cursor motion', () => {
    render();
    const before = counter.checks;

    act(() => useStore.getState().setCursorMm({ x: 3, y: 4 }));

    expect(counter.checks).toBe(before);
  });

  // The poll's own bookkeeping reaches no control here.
  it('does not re-check framed-run readiness on status-poll bookkeeping', () => {
    render();
    const before = counter.checks;

    act(() => useLaserStore.setState({ statusSequence: 42 }));

    expect(counter.checks).toBe(before);
  });

  // Only the progress-bar leaf follows the line count. The section itself
  // branches on the stream status, which acknowledgements do not change.
  it('moves the progress bar without re-rendering the Job section per acknowledgement', () => {
    vi.useFakeTimers();
    const streaming = step(createStreamer('G1 X1 S100\nG1 X2 S100')).state;
    act(() => useLaserStore.setState({ streamer: { ...streaming, completed: 0, total: 100 } }));
    render();
    const before = counter.checks;

    for (let completed = 1; completed <= 20; completed += 1) {
      act(() => useLaserStore.setState({ streamer: { ...streaming, completed, total: 100 } }));
      act(() => {
        vi.advanceTimersByTime(150);
      });
    }

    expect(host?.textContent).toContain('20 / 100 lines');
    expect(counter.checks).toBe(before);
  });

  it('re-checks framed-run readiness when placement changes', () => {
    render();
    const before = counter.checks;

    act(() => useStore.getState().setJobPlacement({ anchor: 'center' }));

    expect(counter.checks).toBeGreaterThan(before);
  });
});

function render(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<JobControls disabled={false} onStartJob={() => undefined} />);
  });
}
