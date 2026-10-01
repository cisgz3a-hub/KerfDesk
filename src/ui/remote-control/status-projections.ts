import type { RemoteControlOptions, SafeRemoteJobReview } from './types';
import { finite } from './validation';
import { publicIdentifier, safeLabel } from './projections';
import { RemoteFault } from './fault';

export function appStatusProjection(options: RemoteControlOptions): Record<string, unknown> {
  const { app, edition, updates } = options.getAppStatus();
  if (
    app.platform !== 'desktop' ||
    !['free', 'pro', 'trial', 'preview'].includes(edition.mode) ||
    typeof updates.available !== 'boolean'
  )
    throw new RemoteFault('unavailable');
  return {
    app: {
      name: safeLabel(app.name, 'KerfDesk'),
      version: safeLabel(app.version, 'unknown', 128),
      platform: 'desktop',
    },
    edition: {
      mode: edition.mode,
      ...(validTrialEnd(edition.trialEndsAt) ? { trialEndsAt: edition.trialEndsAt } : {}),
      ...(typeof edition.updateEligible === 'boolean'
        ? { updateEligible: edition.updateEligible }
        : {}),
    },
    updates: {
      available: updates.available,
      ...(typeof updates.version === 'string'
        ? { version: safeLabel(updates.version, 'unknown', 128) }
        : {}),
      ...(Array.isArray(updates.highlights)
        ? {
            highlights: updates.highlights
              .slice(0, 20)
              .filter((line): line is string => typeof line === 'string')
              .map((line) => safeLabel(line, 'Update improvement', 2048)),
          }
        : {}),
    },
  };
}
function validTrialEnd(value: unknown): boolean {
  return (
    (typeof value === 'number' && finite(value, 0, Number.MAX_SAFE_INTEGER)) ||
    (typeof value === 'string' && value.length <= 128 && Number.isFinite(Date.parse(value)))
  );
}
export function reviewProjection(
  options: RemoteControlOptions,
  revision: string,
  mode: 'laser' | 'cnc',
): Record<string, unknown> {
  const review = options.getReview?.();
  if (
    review === undefined ||
    review === null ||
    review.revision !== revision ||
    review.mode !== mode
  ) {
    return {
      status: 'unavailable',
      mode,
      warnings: [],
      frame: { required: true, complete: false },
    };
  }
  if (!['ready', 'unavailable', 'preparing'].includes(review.status))
    throw new RemoteFault('unavailable');
  return {
    status: review.status,
    mode,
    ...reviewSummary(review),
    warnings: review.warnings.slice(0, 200).map((warning) => ({
      code: safeLabel(warning.code, 'review-warning', 128) || 'review-warning',
      message: safeLabel(warning.message, 'Review this warning in KerfDesk.', 512),
      ...(['info', 'warning', 'error'].includes(warning.severity ?? '')
        ? { severity: warning.severity }
        : {}),
      ...(publicIdentifier(warning.operationId) ? { operationId: warning.operationId } : {}),
    })),
    frame: {
      required: true,
      complete: review.status === 'ready' && review.frame.complete === true,
    },
  };
}
function reviewSummary(review: SafeRemoteJobReview): Record<string, unknown> {
  const summary = review.summary;
  if (summary === undefined || !count(summary.artworkCount) || !count(summary.operationCount))
    return {};
  return {
    summary: {
      artworkCount: summary.artworkCount,
      operationCount: summary.operationCount,
      ...(finite(summary.estimatedSeconds, 0, Number.MAX_SAFE_INTEGER)
        ? { estimatedSeconds: summary.estimatedSeconds }
        : {}),
      // Bounds are omitted here; the existing review owner still shows its exact preview locally.
    },
  };
}
function count(value: number): boolean {
  return finite(value, 0, Number.MAX_SAFE_INTEGER) && Number.isInteger(value);
}
