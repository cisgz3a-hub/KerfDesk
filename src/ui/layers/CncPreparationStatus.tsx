import { useMemo } from 'react';
import {
  cncPreparationInputs,
  cncDependencyStatuses,
} from '../../core/cnc/cnc-preparation-dependencies';
import { useCncPreparationEvidenceStore } from '../state/cnc-preparation-evidence-store';
import { useOutputScope, useStore } from '../state';

export function CncPreparationStatus(): JSX.Element | null {
  const project = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const scope = useOutputScope();
  const evidence = useCncPreparationEvidenceStore((state) => state.evidence);
  const rows = useMemo(
    () =>
      cncDependencyStatuses(
        cncPreparationInputs(project, scope),
        evidence?.documentEpoch === epoch ? evidence.inputs : undefined,
      ),
    [project, scope, evidence, epoch],
  );
  if (project.machine?.kind !== 'cnc') return null;
  return (
    <details aria-label="CNC preparation status" className="lf-artwork-disclosure">
      <summary title="Review machining input changes since the last Preview or Export in this document session. Output still prepares the current job.">
        Machining inputs · {rows.filter((row) => row.status === 'dirty').length} changed operations
      </summary>
      <div className="lf-artwork-disclosure__body">
        <p>
          Compared with the last completed{' '}
          {evidence?.documentEpoch === epoch ? evidence.source : 'preparation'} in this document
          session. Every export and Start still prepares current output.
        </p>
        {rows.map((row) => (
          <div key={row.operationId}>
            <strong>
              {row.name}: {row.status.replace('-', ' ')}
            </strong>
            {row.reasons.length > 0 ? (
              <ul>
                {row.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}
