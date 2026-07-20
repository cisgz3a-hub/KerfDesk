import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import type { JobBounds } from '../../core/job';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { JobControls } from './JobControls';
import { JobReviewDialog } from './job-review';
import { useJobReviewStore } from './job-review/job-review-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    streamer: null,
    statusReport: null,
    homingState: 'unknown',
    activeWcs: null,
    workOriginActive: false,
    wcoCache: null,
    motionOperation: null,
    framedRun: null,
    frameVerification: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  useJobReviewStore.getState().close();
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('JobControls laser motion Frame', () => {
  it('physically Frames the 4040 motion envelope, including runways and scan offset', async () => {
    installNeotronicsFillProject();
    useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
    const originalFrame = useLaserStore.getState().frame;
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        useLaserStore.setState({
          motionOperation: {
            operationId: 1,
            kind: 'frame',
            candidate,
            sawControllerBusy: false,
            idleStatusReports: 0,
            dispatchComplete: true,
            pendingLines: [],
          },
        });
        useLaserStore.setState((laser) => ({
          motionOperation: null,
          framedRun: createFramedRunPermit(candidate, laser),
          frameVerification: candidate.frameVerification,
        }));
      },
    );
    useLaserStore.setState({
      frame,
      streamer: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      activeWcs: 'G54',
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <>
            <JobControls disabled={false} onStartJob={() => undefined} />
            <JobReviewDialog />
          </>,
        );
      });
      const frameButton = [...host.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Frame job',
      );
      if (frameButton === undefined) throw new Error('Frame button not rendered');

      await act(async () => {
        frameButton.click();
      });
      await act(async () => {
        await vi.waitFor(() => {
          expect(useJobReviewStore.getState().state.kind).toBe('open');
        });
      });
      expect(host.textContent).toContain('Review job before framing');
      expect(frame).not.toHaveBeenCalled();

      const acceptFrame = [...host.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Accept & Frame',
      );
      if (acceptFrame === undefined) throw new Error('Review confirmation button not rendered');
      await act(async () => {
        acceptFrame.click();
      });
      await act(async () => {
        await vi.waitFor(() => expect(frame).toHaveBeenCalledTimes(1));
      });

      expect(frame).toHaveBeenCalledTimes(1);
      const framedBounds = frame.mock.calls[0]?.[0];
      // 5 mm runway alone reaches X95. A +2 mm reverse-row calibration shifts
      // that row's left-side runway farther, so the physical Frame must exceed it.
      expect(framedBounds?.minX).toBeLessThan(95);
      expect(framedBounds?.maxX).toBeGreaterThan(110);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });
});

function installNeotronicsFillProject(): void {
  useStore.setState({
    project: {
      ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
      scene: {
        ...EMPTY_SCENE,
        layers: [
          {
            ...createLayer({ id: 'L-fill', color: '#ff0000', mode: 'fill' }),
            fillOverscanMm: 5,
            hatchSpacingMm: 2,
            allowUncalibratedBidirectionalScan: true,
            bidirectionalScanOffsetMm: 2,
            power: 10,
          },
        ],
        objects: [
          {
            kind: 'imported-svg',
            id: 'fill-centered',
            source: 'fill.svg',
            bounds: { minX: 100, minY: 100, maxX: 110, maxY: 110 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 100, y: 100 },
                      { x: 110, y: 100 },
                      { x: 110, y: 110 },
                      { x: 100, y: 110 },
                      { x: 100, y: 100 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
}
