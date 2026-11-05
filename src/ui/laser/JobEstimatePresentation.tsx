import { estimateStyle } from './JobControls.styles';
import type { LiveJobEstimate } from './live-job-estimate';

// A large job has no live time; it says where to get one, in words a beginner
// knows (UX audit U3-P3-5: "large traces" named an internal for a photo).
export const LARGE_JOB_TIME_TITLE =
  'Large job: open Preview to calculate the time. The live estimate is paused so the canvas stays responsive.';

export function startJobTitle(estimate: LiveJobEstimate, timeNoun: string): string {
  if (estimate.kind === 'estimated') return `Estimated ${timeNoun} time: ${estimate.label}`;
  if (estimate.kind === 'too-large') {
    return estimate.ordinary === true
      ? 'Estimating the job time in the background.'
      : LARGE_JOB_TIME_TITLE;
  }
  if (estimate.kind === 'preparation-failed') {
    return `Live estimate unavailable: ${estimate.message}`;
  }
  return 'Enable Output on at least one layer to start a job';
}

export function EstimateBadge({
  estimate,
}: {
  readonly estimate: LiveJobEstimate;
}): JSX.Element | null {
  if (estimate.kind === 'estimated')
    return (
      <span style={estimateStyle}>
        ≈ {estimate.label}
        {(estimate.manualPauseCount ?? 0) > 0 ? ' + tool changes' : ''}
      </span>
    );
  if (estimate.kind === 'too-large') {
    return estimate.ordinary === true ? (
      <span style={estimateStyle} title="Estimating the job time in the background.">
        estimating…
      </span>
    ) : (
      <span style={estimateStyle} title={LARGE_JOB_TIME_TITLE}>
        time: see Preview
      </span>
    );
  }
  if (estimate.kind === 'preparation-failed') {
    return (
      <span style={estimateStyle} title={estimate.message}>
        ETA unavailable
      </span>
    );
  }
  return null;
}
