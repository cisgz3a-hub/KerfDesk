import type { ControllerSettingsSnapshot } from '../../core/preflight';

export type FrameMotionFeeds = {
  readonly xyMmPerMin: number;
  readonly zMmPerMin: number;
};

/** Keep each Frame axis at or below every live controller maximum we know. */
export function frameMotionFeeds(
  requestedMmPerMin: number,
  controller: ControllerSettingsSnapshot | null,
): FrameMotionFeeds {
  return {
    xyMmPerMin: capFeed(requestedMmPerMin, [controller?.maxFeedX, controller?.maxFeedY]),
    zMmPerMin: capFeed(requestedMmPerMin, [controller?.zMaxFeed]),
  };
}

function capFeed(requestedMmPerMin: number, limits: ReadonlyArray<number | undefined>): number {
  return limits.reduce<number>(
    (feed, limit) =>
      limit !== undefined && Number.isFinite(limit) && limit > 0 ? Math.min(feed, limit) : feed,
    requestedMmPerMin,
  );
}
