import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { JOB_ESTIMATE_DEBOUNCE_MS, useJobEstimate } from '../laser/use-job-estimate';
import { usePreviewToolpath } from './use-preview-toolpath';
import { coordinateEntryMachine, coordinateEntryProject } from './runtime-coordinate.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const original = useLaserStore.getState();

afterEach(() => {
  useLaserStore.setState(original, true);
  resetStore();
  vi.useRealTimers();
});

describe('runtime Preview and ETA evidence invalidation', () => {
  it('updates both when native reference is lost without rebuilding for unchanged evidence', async () => {
    vi.useFakeTimers();
    resetStore();
    const project = coordinateEntryProject();
    const machine = coordinateEntryMachine(project);
    useStore.setState({
      project,
      jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    useLaserStore.setState({
      ...initialLaserState(),
      ...machine,
      connection: { kind: 'connected' },
      homingState: 'confirmed',
      workOriginSource: 'g92',
    });
    const schedule = vi.fn((work: () => void) => {
      work();
      return () => undefined;
    });
    let latest:
      | {
          preview: ReturnType<typeof usePreviewToolpath>;
          estimate: ReturnType<typeof useJobEstimate>;
        }
      | undefined;
    function Harness(): null {
      const preview = usePreviewToolpath(project, true, schedule);
      const estimate = useJobEstimate();
      latest = { preview, estimate };
      return null;
    }
    const current = () => {
      if (latest === undefined) throw new Error('Hook fixture did not render');
      return latest;
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1));
      const before = current();
      expect(before.preview).not.toBeNull();
      expect(before.estimate.kind).toBe('estimated');
      const scheduled = schedule.mock.calls.length;
      await act(async () =>
        useLaserStore.setState({
          controllerSettingsObservation: { sessionEpoch: 7, observedAt: 2 },
        }),
      );
      await act(async () => vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1));
      expect(schedule).toHaveBeenCalledTimes(scheduled);
      expect(current().estimate).toBe(before.estimate);

      await act(async () => useLaserStore.setState({ homingState: 'unknown' }));
      await act(async () => vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1));
      expect(schedule.mock.calls.length).toBeGreaterThan(scheduled);
      const after = current();
      expect(after.preview?.previewIssue).toBeUndefined();
      expect(after.preview?.totalLength).not.toBe(before.preview?.totalLength);
      expect(after.estimate.kind).toBe('estimated');
      expect(after.estimate).not.toEqual(before.estimate);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
