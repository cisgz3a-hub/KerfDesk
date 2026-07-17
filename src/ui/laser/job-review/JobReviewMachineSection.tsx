// Collapsible read-only machine/profile facts for the Job Review dialog
// (ADR-224): bed, origin corner, dialect, laser power scale / air / rotary
// or CNC stock, bit, safe-Z, spindle, coolant, park — plus the ordered tool
// plan of the exact prepared program.

import type { MachineKind } from '../../../core/scene';
import { useStore } from '../../state';
import { buildMachineReviewFacts } from './job-review-live-rows';
import {
  detailsStyle,
  detailsSummaryStyle,
  factListStyle,
  mutedNoteStyle,
  toolPlanListStyle,
} from './job-review.styles';
import { JobReviewFactRow } from './JobReviewFactRow';

export function JobReviewMachineSection(props: {
  readonly machineKind: MachineKind;
  readonly toolPlanLabels: ReadonlyArray<string>;
}): JSX.Element {
  const project = useStore((s) => s.project);
  const facts = buildMachineReviewFacts(project);
  return (
    <details style={detailsStyle}>
      <summary
        style={detailsSummaryStyle}
        title="Expand to review the machine profile facts: bed, origin, dialect, and the laser or CNC setup this job will run with."
      >
        Machine — {project.device.name}
      </summary>
      <dl style={factListStyle}>
        {facts.map((entry) => (
          <JobReviewFactRow key={entry.label} label={entry.label} tone={entry.tone}>
            {entry.value}
          </JobReviewFactRow>
        ))}
      </dl>
      {props.machineKind === 'cnc' && props.toolPlanLabels.length > 0 ? (
        <>
          <p style={mutedNoteStyle}>Bits in run order (each change pauses with M0):</p>
          <ol style={toolPlanListStyle}>
            {props.toolPlanLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ol>
        </>
      ) : null}
    </details>
  );
}
