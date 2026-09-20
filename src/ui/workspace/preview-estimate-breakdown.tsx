import { formatDuration } from '../../core/job';
import type { LiveJobEstimate } from '../laser/live-job-estimate';

export function PreviewEstimateBreakdown({
  estimate,
  includesPlunge = false,
}: {
  readonly estimate: LiveJobEstimate;
  readonly includesPlunge?: boolean;
}): JSX.Element | null {
  if (estimate.kind !== 'estimated') return null;
  const { breakdown } = estimate;
  const dwellSeconds = breakdown.dwellSeconds ?? 0;
  const transportSeconds = breakdown.transportSeconds ?? 0;
  return (
    <>
      <span>{includesPlunge ? 'Cut + plunge time' : 'Cut time'}</span>
      <strong>{formatDuration(breakdown.cutSeconds)}</strong>
      <span>Travel time</span>
      <strong>{formatDuration(breakdown.travelSeconds)}</strong>
      {dwellSeconds > 0 ? (
        <>
          <span title="Included in total time. Route playback spreads waits across the displayed path.">
            {includesPlunge ? 'Spindle dwell' : 'Dwell time'}
          </span>
          <strong>{formatDuration(dwellSeconds)}</strong>
        </>
      ) : null}
      {transportSeconds >= 0.5 ? (
        <>
          <span>Streaming time</span>
          <strong>{formatDuration(transportSeconds)}</strong>
        </>
      ) : null}
      {(estimate.manualPauseCount ?? 0) > 0 ? (
        <>
          <span>Tool changes</span>
          <strong>Operator time excluded</strong>
        </>
      ) : null}
    </>
  );
}
