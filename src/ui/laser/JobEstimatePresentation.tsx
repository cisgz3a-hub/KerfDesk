import { estimateStyle } from './JobControls.styles';
import type { LiveJobEstimate } from './live-job-estimate';

export function startJobTitle(estimate: LiveJobEstimate, timeNoun: string): string {
  if (estimate.kind === 'estimated') return `Estimated ${timeNoun} time: ${estimate.label}`;
  if (estimate.kind === 'too-large') {
    return 'Large job: the live estimate is paused to keep the canvas responsive.';
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
  if (estimate.kind === 'estimated') return <span style={estimateStyle}>≈ {estimate.label}</span>;
  if (estimate.kind === 'too-large') {
    return (
      <span style={estimateStyle} title="Live estimate paused so large traces stay responsive.">
        large job
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
