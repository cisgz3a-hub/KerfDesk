import { formatDuration } from '../../core/job';
import type { LiveJobEstimate } from '../laser/live-job-estimate';

export function PreviewEstimateBreakdown({
  estimate,
  includesPlunge = false,
  programTiming = false,
}: {
  readonly estimate: LiveJobEstimate;
  readonly includesPlunge?: boolean;
  readonly programTiming?: boolean;
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
      <DwellBreakdown
        seconds={dwellSeconds}
        includesPlunge={includesPlunge}
        programTiming={programTiming}
      />
      {transportSeconds >= 0.5 ? (
        <>
          <span>Streaming time</span>
          <strong>{formatDuration(transportSeconds)}</strong>
        </>
      ) : null}
      {(estimate.manualPauseCount ?? 0) > 0 ? (
        <>
          <span>{programTiming ? 'Manual pauses' : 'Tool changes'}</span>
          <strong>Operator time excluded</strong>
        </>
      ) : null}
    </>
  );
}

function DwellBreakdown(props: {
  readonly seconds: number;
  readonly includesPlunge: boolean;
  readonly programTiming: boolean;
}): JSX.Element | null {
  if (props.seconds <= 0) return null;
  return (
    <>
      <span
        title={
          props.programTiming
            ? 'Included in total time at its source line.'
            : 'Included in total time. Route playback spreads waits across the displayed path.'
        }
      >
        {props.includesPlunge && !props.programTiming ? 'Spindle dwell' : 'Dwell time'}
      </span>
      <strong>{formatDuration(props.seconds)}</strong>
    </>
  );
}
