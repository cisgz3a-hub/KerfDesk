import type { RemoteBounds, RemoteControlOptions, SafeRemoteJobReview } from './types';
import { finite } from './validation';
import { publicIdentifier, safeLabel } from './projections';
import { RemoteFault } from './fault';
import { reviewMessageProjector } from './review-message-sharing';

// Keep full warning strings only while their projection is owned by the pending
// read. A final opt-out fence can redact before truncating, without recompiling.
const reviewSources = new WeakMap<Record<string, unknown>, SafeRemoteJobReview>();

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
export async function reviewProjection(
  options: RemoteControlOptions,
  revision: string,
  mode: 'laser' | 'cnc',
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const review = await options.getReview?.(revision, signal);
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
  const projected = projectReview(review, options);
  reviewSources.set(projected, review);
  return projected;
}

/** Final synchronous disclosure fence; it never calls the preparation owner. */
export function redactReviewProjection(
  data: Record<string, unknown>,
  options: RemoteControlOptions,
): Record<string, unknown> {
  const source = reviewSources.get(data);
  if (options.canShareArtwork?.() === true) return data;
  if (source === undefined) {
    if (
      typeof data['message'] === 'string' ||
      (Array.isArray(data['warnings']) && data['warnings'].length > 0)
    )
      throw new RemoteFault('unavailable');
    return data;
  }
  const projected = projectReview(source, options);
  reviewSources.set(projected, source);
  return projected;
}

/** The renderer retires the extra disclosure binding once delivery is complete. */
export function releaseReviewProjection(data: Record<string, unknown>): void {
  reviewSources.delete(data);
}

function projectReview(
  review: SafeRemoteJobReview,
  options: RemoteControlOptions,
): Record<string, unknown> {
  const projectMessage = reviewMessageProjector(options);
  return {
    status: review.status,
    mode: review.mode,
    ...(typeof review.message === 'string'
      ? { message: projectMessage(review.message, 'Review this job on the PC.') }
      : {}),
    ...reviewSummary(review),
    warnings: review.warnings.slice(0, 200).map((warning) => ({
      // The canonical owner supplies static index codes, never artwork wording.
      code: safeLabel(warning.code, 'review-warning', 128) || 'review-warning',
      message: projectMessage(
        warning.message,
        'Review this artwork-specific warning in KerfDesk on the PC.',
      ),
      ...(['info', 'warning', 'error'].includes(warning.severity ?? '')
        ? { severity: warning.severity }
        : {}),
      ...(publicIdentifier(warning.operationId) ? { operationId: warning.operationId } : {}),
    })),
    frame: {
      required: true,
      complete: review.frame.complete === true,
    },
  };
}
function reviewSummary(review: SafeRemoteJobReview): Record<string, unknown> {
  const summary = review.summary;
  if (summary === undefined || !count(summary.artworkCount) || !count(summary.operationCount))
    return {};
  const bounds = projectBounds(summary.bounds);
  return {
    summary: {
      artworkCount: summary.artworkCount,
      operationCount: summary.operationCount,
      ...(finite(summary.estimatedSeconds, 0, Number.MAX_SAFE_INTEGER)
        ? { estimatedSeconds: summary.estimatedSeconds }
        : {}),
      ...(bounds === undefined ? {} : { bounds }),
    },
  };
}
function projectBounds(value: unknown): RemoteBounds | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const bounds = value as Record<string, unknown>;
  if (
    !(
      finite(bounds['xMm'], -100_000, 100_000) &&
      finite(bounds['yMm'], -100_000, 100_000) &&
      finite(bounds['widthMm'], 0, 100_000) &&
      finite(bounds['heightMm'], 0, 100_000)
    )
  )
    return undefined;
  return {
    xMm: bounds['xMm'],
    yMm: bounds['yMm'],
    widthMm: bounds['widthMm'],
    heightMm: bounds['heightMm'],
  };
}
function count(value: number): boolean {
  return finite(value, 0, Number.MAX_SAFE_INTEGER) && Number.isInteger(value);
}
