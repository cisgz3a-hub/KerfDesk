// The banner Preview shows instead of a route it cannot draw yet, or at all.
// A large job prepares in the background worker; a large CNC pocket can take
// minutes there, so the banner names the worker's phase and progress and
// offers the way out: leaving Preview cancels the preparation (S8-P3-3).

import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import { preparationProgressSuffix } from '../laser/preparation-progress-text';
import { useStore } from '../state/store';
import type { PreviewIssue } from './preview-status';

export function PreviewIssueBanner(props: {
  readonly issue: PreviewIssue | null;
}): JSX.Element | null {
  if (props.issue?.kind === 'too-complex') {
    return (
      <div className="lf-banner lf-banner--warning" style={bannerStyle} role="status">
        Route preview is too large to draw safely. Simplify the trace or reduce detail, then preview
        again.
      </div>
    );
  }
  if (props.issue?.kind === 'preparing-large-job') {
    return <PreparingLargeJobBanner progress={props.issue.progress ?? null} />;
  }
  if (props.issue?.kind === 'placement-unavailable') {
    return (
      <div className="lf-banner lf-banner--warning" style={bannerStyle} role="status">
        Preview unavailable: {props.issue.messages.join(' ')}
      </div>
    );
  }
  if (props.issue?.kind === 'preparation-failed') {
    return (
      <div className="lf-banner lf-banner--danger" style={bannerStyle} role="alert">
        Preview unavailable: {props.issue.messages.join(' ')}
      </div>
    );
  }
  return null;
}

function PreparingLargeJobBanner(props: {
  readonly progress: OutputCompilationProgress | null;
}): JSX.Element {
  const togglePreview = useStore((state) => state.togglePreview);
  return (
    <div className="lf-banner" style={preparingStyle}>
      <span role="status">
        Large job: preparing the route preview in the background
        {preparationProgressSuffix(props.progress)}. It will appear here when ready — Start and Save
        do not wait for it.
      </span>
      <button
        type="button"
        className="lf-btn"
        style={leaveStyle}
        onClick={togglePreview}
        title="Leave Preview and stop preparing it. Your design is unchanged."
      >
        Leave Preview
      </button>
    </div>
  );
}

const bannerStyle: React.CSSProperties = { fontFamily: 'system-ui, sans-serif' };

const preparingStyle: React.CSSProperties = {
  ...bannerStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const leaveStyle: React.CSSProperties = { flexShrink: 0 };
