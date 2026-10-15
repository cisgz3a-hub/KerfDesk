import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../core/scene';
import { useStore } from '../state/store';
import { writeStartPointDefaults } from '../state/start-point-defaults';
import { reusableStartPoints, type StartEditingContext } from './canvas-start-editing';
import { startEditingBusy } from './start-point-interaction';
import { isIdleCanvasMotionSuperseded } from './idle-canvas-motion-worker-client';

export function StartPointSettings(props: {
  readonly project: Project;
  readonly context: StartEditingContext | undefined;
  readonly disabled: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const { message, setMessage, saving, save } = useSaveDefaults(props.context);
  const disabled = props.disabled || saving;
  const settings = props.project.startPoints ?? {};
  const sideB = isCncSideB(props.project);
  const defaultsReason = defaultSaveReason(props.context);
  return (
    <div className="lf-start-settings lf-chip">
      <StartPointSettingsHeading open={open} setOpen={setOpen} />
      {open && (
        <div className="lf-start-settings-panel" role="group" aria-label="Start point settings">
          <p>Drag the handles to choose starts. Selections are saved with this project.</p>
          <p>Job start stays within the first operation and respects inside-first cutting.</p>
          <button
            type="button"
            className="lf-btn"
            disabled={disabled || settings.frame === undefined}
            onClick={() => resetStartPoint(props.project, 'frame')}
            title="Reset this project to its automatic frame entry."
          >
            Automatic frame start
          </button>
          <button
            type="button"
            className="lf-btn"
            disabled={disabled || sideB || settings.job === undefined}
            onClick={() => resetStartPoint(props.project, 'job')}
            title={
              sideB
                ? 'Switch to Side A before resetting the cutting start.'
                : 'Reset this project to its automatic first cutting point.'
            }
          >
            Automatic job start
          </button>
          <button
            type="button"
            className="lf-btn"
            disabled={disabled || props.context === undefined || defaultsReason !== undefined}
            title={defaultsReason ?? 'Remember these relative starts for new jobs on this device.'}
            onClick={() => {
              void save();
            }}
          >
            Use as defaults for new jobs
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            disabled={disabled}
            onClick={() => setMessage(clearDefaultsMessage(props.project))}
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

function StartPointSettingsHeading({
  open,
  setOpen,
}: {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}): JSX.Element {
  const toggleRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="lf-start-settings-heading">
      <button
        ref={toggleRef}
        type="button"
        className="lf-btn lf-btn--ghost"
        aria-expanded={open}
        title="Choose automatic starts or save defaults for new jobs."
        onClick={() => setOpen(!open)}
      >
        Start points
      </button>
      {open && (
        <button
          type="button"
          className="lf-btn lf-btn--ghost lf-start-settings-close"
          aria-label="Close start point settings"
          title="Close start point settings"
          onClick={() => {
            setOpen(false);
            toggleRef.current?.focus();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

function useSaveDefaults(context: StartEditingContext | undefined) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const currentContext = useRef(context);
  currentContext.current = context;
  const saveToken = useRef(0);
  useEffect(
    () => () => {
      saveToken.current += 1;
    },
    [],
  );
  const save = async (): Promise<void> => {
    const token = ++saveToken.current;
    setSaving(true);
    setMessage('Preparing defaults…');
    const result = await saveDefaultsMessage(
      context,
      () => token === saveToken.current && currentContext.current === context,
    );
    if (token !== saveToken.current) return;
    setSaving(false);
    setMessage(result);
  };
  return { message, setMessage, saving, save };
}

function clearDefaultsMessage(project: Project): string {
  const state = useStore.getState();
  if (startEditingBusy() || state.project !== project || state.pendingUndo !== null) return '';
  return writeStartPointDefaults({})
    ? 'New jobs will use automatic starts.'
    : 'Could not clear defaults on this device.';
}

function resetStartPoint(project: Project, kind: 'frame' | 'job'): void {
  const state = useStore.getState();
  if (startEditingBusy() || state.project !== project || state.pendingUndo !== null) return;
  if (kind === 'job' && isCncSideB(project)) return;
  const next = { ...project.startPoints };
  if (kind === 'frame') delete next.frame;
  else delete next.job;
  useStore.getState().setProjectStartPoints(next);
}

function defaultSaveReason(context: StartEditingContext | undefined): string | undefined {
  if (context?.registered) return 'Clear Print and Cut registration before saving defaults.';
  if (context !== undefined && isCncSideB(context.sourceProject))
    return 'Switch to Side A before saving defaults.';
  return undefined;
}

function isCncSideB(project: Project): boolean {
  return project.machine?.kind === 'cnc' && project.cncSetup?.twoSided?.activeSide === 'B';
}

async function saveDefaultsMessage(
  context: StartEditingContext | undefined,
  isCurrent: () => boolean,
): Promise<string> {
  if (!canSaveDefaults(context)) return '';
  const epoch = useStore.getState().projectDocumentEpoch;
  try {
    const settings = await reusableStartPoints(context);
    const current = useStore.getState();
    if (
      !isCurrent() ||
      current.project !== context.sourceProject ||
      current.projectDocumentEpoch !== epoch ||
      current.pendingUndo !== null ||
      startEditingBusy()
    ) {
      return 'Defaults were not saved because the project or machine state changed.';
    }
    return writeStartPointDefaults(settings)
      ? 'Saved for new jobs on this device.'
      : 'Could not save defaults on this device.';
  } catch (error) {
    if (isIdleCanvasMotionSuperseded(error))
      return 'Defaults were not saved because preparation was replaced. Try again.';
    return 'Could not prepare defaults. Try again when the current job is ready.';
  }
}

function canSaveDefaults(context: StartEditingContext | undefined): context is StartEditingContext {
  const state = useStore.getState();
  return (
    context !== undefined &&
    !startEditingBusy() &&
    state.pendingUndo === null &&
    defaultSaveReason(context) === undefined &&
    context.sourceProject === state.project
  );
}
