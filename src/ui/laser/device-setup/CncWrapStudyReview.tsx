import { useMemo, useRef, useState } from 'react';
import type { Project, CncMachineConfig } from '../../../core/scene';
import type { CncMachiningSetup } from '../../../core/scene/cnc-machining-setup';
import type { CncWrapStudy } from '../../../core/scene/cnc-wrap-study';
import { parseCncWrapStudy } from '../../../io/project/project-cnc-wrap-study-validator';
import { buildCncWrapStudyArtifact } from '../../../io/cnc/cnc-wrap-study-artifact';
import { useStore } from '../../state';
import { pickPreparedSaveTarget } from '../../app/pick-prepared-save-target';
import { usePlatformOptional } from '../../app/platform-context';
import { Dialog } from '../../kit';

/** The study validated, then built into its reference artifact for this project. */
function useWrapStudyArtifact(
  project: Project,
  machine: CncMachineConfig,
  setup: CncMachiningSetup,
  study: CncWrapStudy,
) {
  return useMemo(() => {
    const parsed = parseCncWrapStudy(study);
    if (parsed.kind === 'invalid') return { kind: 'unavailable' as const, reason: parsed.reason };
    return buildCncWrapStudyArtifact({ ...project, machine, cncSetup: setup }, study);
  }, [project, machine, setup, study]);
}

export function CncWrapStudyReview(props: {
  readonly project: Project;
  readonly machine: CncMachineConfig;
  readonly setup: CncMachiningSetup;
  readonly study: CncWrapStudy;
  readonly onClose: () => void;
}): JSX.Element {
  const platform = usePlatformOptional(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    writing = useRef(false);
  const artifact = useWrapStudyArtifact(props.project, props.machine, props.setup, props.study);
  function save(): void {
    if (platform === null || artifact.kind !== 'ok' || writing.current) return;
    if (useStore.getState().project !== props.project) {
      setError('The source project changed. Reopen the reference study.');
      return;
    }
    writing.current = true;
    setBusy(true);
    // The picker empties an existing file as it returns (ADR-656): the picked
    // file gets the study reviewed at the click, even if the project changed.
    const source = props.project;
    void pickPreparedSaveTarget(
      platform,
      { suggestedName: 'cnc-wrap-study.json', extensions: ['.json'] },
      { title: 'Save CNC wrap study', message: 'The study and reference program are ready.' },
    )
      .then(async (destination) => {
        if (destination === null) return;
        await destination.write(artifact.json);
        setError(
          useStore.getState().project === source
            ? ''
            : 'Saved the study from before the source project changed. Save again to include the change.',
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        writing.current = false;
        setBusy(false);
      });
  }
  return (
    <Dialog title="Offline CNC wrap reference" size="lg" onClose={props.onClose}>
      {artifact.kind === 'unavailable' ? (
        <p role="alert">{artifact.reason}</p>
      ) : (
        <>
          <p>{artifact.pathCount} explicitly mapped paths. Qualification: reference model only.</p>
          {artifact.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <details>
            <summary title="Inspect the reference program for offline controller simulation">
              Reference program for controller simulation
            </summary>
            <pre>{artifact.program}</pre>
          </details>
          <button
            title="Save the offline wrap study and its reference program in a JSON file"
            type="button"
            disabled={platform === null || busy}
            onClick={save}
          >
            Save study and reference program as JSON
          </button>
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <button title="Close the wrap study review" type="button" onClick={props.onClose}>
        Close
      </button>
    </Dialog>
  );
}
