import { useState } from 'react';
import type { Project } from '../../core/scene';
import { useStore } from '../state/store';
import { writeStartPointDefaults } from '../state/start-point-defaults';
import { reusableStartPoints, type StartEditingContext } from './canvas-start-editing';
import { startEditingBusy } from './start-point-interaction';

export function StartPointSettings(props: {
  readonly project: Project;
  readonly context: StartEditingContext | undefined;
  readonly disabled: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const settings = props.project.startPoints ?? {};
  const defaultsReason = defaultSaveReason(props.context);
  const save = (): void => {
    if (
      props.context === undefined ||
      defaultsReason !== undefined ||
      props.context.sourceProject !== useStore.getState().project
    )
      return;
    const success = writeStartPointDefaults(reusableStartPoints(props.context));
    setMessage(
      success ? 'Saved for new jobs on this device.' : 'Could not save defaults on this device.',
    );
  };
  return (
    <div className="lf-start-settings lf-chip">
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        aria-expanded={open}
        title="Choose automatic starts or save defaults for new jobs."
        onClick={() => setOpen(!open)}
      >
        Start points
      </button>
      {open && (
        <div className="lf-start-settings-panel" role="group" aria-label="Start point settings">
          <p>Drag the handles to choose starts. Selections are saved with this project.</p>
          <p>Job start stays within the first operation and respects inside-first cutting.</p>
          <button
            type="button"
            className="lf-btn"
            disabled={props.disabled || settings.frame === undefined}
            onClick={() => resetStartPoint(props.project, 'frame')}
            title="Reset this project to its automatic frame entry."
          >
            Automatic frame start
          </button>
          <button
            type="button"
            className="lf-btn"
            disabled={props.disabled || settings.job === undefined}
            onClick={() => resetStartPoint(props.project, 'job')}
            title="Reset this project to its automatic first cutting point."
          >
            Automatic job start
          </button>
          <button
            type="button"
            className="lf-btn"
            disabled={props.disabled || props.context === undefined || defaultsReason !== undefined}
            title={defaultsReason ?? 'Remember these relative starts for new jobs on this device.'}
            onClick={save}
          >
            Use as defaults for new jobs
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            onClick={() => setMessage(clearDefaultsMessage())}
            title="Use automatic starts for future jobs without changing this project."
          >
            Clear saved defaults
          </button>
          <small>Defaults remember a relative position for differently sized artwork.</small>
          <span role="status">{message}</span>
        </div>
      )}
    </div>
  );
}

function clearDefaultsMessage(): string {
  return writeStartPointDefaults({})
    ? 'New jobs will use automatic starts.'
    : 'Could not clear defaults on this device.';
}

function resetStartPoint(project: Project, kind: 'frame' | 'job'): void {
  if (startEditingBusy() || useStore.getState().project !== project) return;
  const next = { ...project.startPoints };
  if (kind === 'frame') delete next.frame;
  else delete next.job;
  useStore.getState().setProjectStartPoints(next);
}

function defaultSaveReason(context: StartEditingContext | undefined): string | undefined {
  if (context?.registered) return 'Clear Print and Cut registration before saving defaults.';
  if (context?.sourceProject.cncSetup?.twoSided?.activeSide === 'B')
    return 'Switch to Side A before saving defaults.';
  return undefined;
}
