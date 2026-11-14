// The height rule under the Material height control (ADR-441 Amendment 13):
// what the project knows that the Material height disagrees with.

import { useStore } from '../state';
import { useActiveCameraModel } from './active-camera-model';
import { cameraHeightFacts, cameraHeightIssues, cameraHeightNote } from './camera-height-rule';

export function CameraHeightNotes(props: { readonly surfaceHeightMm: number }): JSX.Element | null {
  const device = useStore((s) => s.project.device);
  const machine = useStore((s) => s.project.machine);
  const jobSetup = useStore((s) => s.project.jobSetup);
  const model = useActiveCameraModel();
  const project = { device, jobSetup, ...(machine === undefined ? {} : { machine }) };
  const facts = cameraHeightFacts(project, props.surfaceHeightMm, model);
  const issues = cameraHeightIssues(facts);
  if (issues.length === 0) return null;
  return (
    <div role="status" style={noteStyle}>
      {issues.map((issue) => (
        <p key={issue.kind} style={lineStyle}>
          {cameraHeightNote(issue)}
        </p>
      ))}
    </div>
  );
}

const noteStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-warning-fg)' };
const lineStyle: React.CSSProperties = { margin: 0 };
