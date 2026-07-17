// Job placement section of the Job Review dialog (ADR-224): the live,
// editable placement controls (start-from mode, anchor, output scope —
// the exact component from the job panel) plus read-only rows for the
// origin the shown G-code actually resolved to and the controller's work
// origin state.

import { PanelHeading } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import type { WorkCoordinateOffset } from '../../state/origin-actions';
import { JobPlacementControls } from '../JobPlacementControls';
import { formatMm } from './job-review-format';
import { factListStyle, sectionStyle } from './job-review.styles';
import { JobReviewFactRow } from './JobReviewFactRow';

export function JobReviewPlacement(props: {
  readonly resolvedOriginLabel: string;
  readonly isPreparing: boolean;
}): JSX.Element {
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  return (
    <section aria-label="Job placement" style={sectionStyle}>
      <PanelHeading level={3}>Job placement</PanelHeading>
      <JobPlacementControls streaming={false} />
      <dl style={factListStyle}>
        <JobReviewFactRow label="Resolved origin" isDimmed={props.isPreparing}>
          {props.resolvedOriginLabel}
        </JobReviewFactRow>
        <JobReviewFactRow label="Work origin">
          {workOriginLabel(workOriginActive, wcoCache)}
        </JobReviewFactRow>
      </dl>
    </section>
  );
}

function workOriginLabel(workOriginActive: boolean, wco: WorkCoordinateOffset | null): string {
  if (!workOriginActive) return 'Machine zero (no custom origin set)';
  if (wco === null) return 'Custom origin set — offset not reported yet';
  return `Custom origin set — offset X ${formatMm(wco.x)} · Y ${formatMm(wco.y)} · Z ${formatMm(wco.z)}`;
}
