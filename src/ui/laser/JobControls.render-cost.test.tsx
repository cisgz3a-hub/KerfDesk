// The machine rail's setup row used to subscribe to BOTH stores whole, so a
// mousemove (setCursorMm) and every write the 250 ms status poll makes re-ran
// the framed-run readiness comparison. Counting that comparison is the cheapest
// honest proxy for "did the setup row re-render".

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  // The progress bar legitimately subscribes to `streamer`, so a burn still
  // re-renders this rail per ack. What must NOT reach the setup row is the
  // poll's own bookkeeping, which no control here reads.
  it('does not re-check framed-run readiness on status-poll bookkeeping', () => {
    render();
    const before = counter.checks;

    act(() => useLaserStore.setState({ statusSequence: 42 }));

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
