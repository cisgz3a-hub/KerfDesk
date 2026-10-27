// Collapsible read-only machine/profile facts for the Job Review dialog
// (ADR-224): bed, origin corner, dialect, laser power scale / air / rotary
// or CNC stock, bit, safe-Z, spindle, coolant, park — plus the ordered tool
// plan of the exact prepared program.

import type { JobOriginPlacement } from '../../../core/job';
import type { MachineKind, Project } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { selectNativeBedEvidence } from '../../state/native-bed-frame';
import {
  checkCncLiftAgainstZTop,
  cncHighestLiftMm,
  type CncLiftZTopCheck,
} from '../cnc-park-z-top';
import { buildMachineReviewFacts, type JobReviewFact } from './job-review-live-rows';
import {
  detailsStyle,
  detailsSummaryCountStyle,
  detailsSummaryStyle,
  factListStyle,
  mutedNoteStyle,
  toolPlanListStyle,
} from './job-review.styles';
import { JobReviewFactRow } from './JobReviewFactRow';

export function JobReviewMachineSection(props: {
  readonly machineKind: MachineKind;
  readonly toolPlanLabels: ReadonlyArray<string>;
  readonly outputQualityFacts: ReadonlyArray<JobReviewFact>;
  readonly project?: Project;
  /** The reviewed job's placement, which decides where an unset park ends. */
  readonly startFrom?: JobOriginPlacement['startFrom'];
}): JSX.Element {
  const liveProject = useStore((s) => s.project);
  const project = props.project ?? liveProject;
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const zTop = useCncParkZTop(project);
  const facts = [
    ...buildMachineReviewFacts(project, controllerSettings, props.startFrom, zTop),
    ...props.outputQualityFacts,
  ];
  return (
    <details style={detailsStyle}>
      <summary
        style={detailsSummaryStyle}
        title="Expand to review the machine profile facts: bed, origin, dialect, and the laser or CNC setup this job will run with."
      >
        Machine — {project.device.name}
        <span style={detailsSummaryCountStyle}>
          · {facts.length} fact{facts.length === 1 ? '' : 's'}
        </span>
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

// The park lift against the live Z top (ADR-491 Amendment 2). Selects the
// offset's Z alone so a fresh status report does not re-render the section.
function useCncParkZTop(project: Project): CncLiftZTopCheck | undefined {
  const evidence = useLaserStore(selectNativeBedEvidence);
  const wcoZ = useLaserStore((s) => (s.statusReport?.wco ?? s.wcoCache)?.z ?? null);
  const unitsUnconfirmed = useLaserStore((s) => s.reportUnitsUnconfirmed === true);
  const activeWcs = useLaserStore((s) => s.activeWcs);
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return undefined;
  return checkCncLiftAgainstZTop(
    cncHighestLiftMm(machine.params),
    {
      ...evidence,
      wcoCache: wcoZ === null ? null : { x: 0, y: 0, z: wcoZ },
      reportUnitsUnconfirmed: unitsUnconfirmed,
      activeWcs,
    },
    project.device.zTravelMm,
  );
}
