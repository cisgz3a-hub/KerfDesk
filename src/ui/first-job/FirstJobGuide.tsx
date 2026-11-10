// The guided first job (ADR-698): a side panel that walks a new operator from
// Connect to Start, highlights the real control for each step and moves on when
// the app's own state changes. It never connects, frames, starts or changes a
// setting itself: "Show me" only opens the panel at the control and focuses
// it, and the sample circle is ordinary, undoable artwork the operator asks for.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IDENTITY_TRANSFORM, machineKindOf } from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { revealSearchTarget } from '../commands/search-entries';
import { Icon } from '../kit/icons';
import { useStore } from '../state';
import { currentDrawingColor } from '../workspace/draw-tool';
import { useFirstJobGuideStore } from './first-job-guide-store';
import {
  FIRST_JOB_STEP_IDS,
  FIRST_JOB_STEPS,
  firstJobProgress,
  type FirstJobProgress,
  type FirstJobStepId,
} from './first-job-steps';
import { useFirstJobSignals } from './use-first-job-signals';
import './first-job-guide.css';

const SAMPLE_DIAMETER_MM = 40;

export function FirstJobGuideHost(): JSX.Element | null {
  const open = useFirstJobGuideStore((state) => state.open);
  return open ? createPortal(<FirstJobGuide />, document.body) : null;
}

export function FirstJobGuide(): JSX.Element {
  const skipped = useFirstJobGuideStore((state) => state.skipped);
  const close = useFirstJobGuideStore((state) => state.closeGuide);
  const cnc = useStore((state) => machineKindOf(state.project.machine) === 'cnc');
  const progress = firstJobProgress(useFirstJobSignals(), skipped);
  const target = progress.current === null ? undefined : FIRST_JOB_STEPS[progress.current].target;
  useHighlight(target);
  const position =
    progress.current === null
      ? FIRST_JOB_STEP_IDS.length
      : FIRST_JOB_STEP_IDS.indexOf(progress.current) + 1;
  return (
    <aside className="lf-first-job" aria-label="Guided first job">
      <header className="lf-first-job__header">
        <div>
          <h2 className="lf-first-job__title">Your first job</h2>
          <p className="lf-first-job__count" aria-live="polite">
            {progress.current === null
              ? 'All steps done'
              : `Step ${position} of ${FIRST_JOB_STEP_IDS.length}: ${FIRST_JOB_STEPS[progress.current].title}`}
          </p>
        </div>
        <button
          type="button"
          className="lf-btn lf-btn--ghost"
          aria-label="Close the guided first job"
          title="Close the guide. Help → Guided first job opens it again where you left off."
          onClick={close}
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      {cnc ? (
        <p className="lf-first-job__note" role="note">
          This guide follows a laser job. Your machine is set up as CNC, so some steps name laser
          controls.
        </p>
      ) : null}
      <ol className="lf-first-job__steps">
        {FIRST_JOB_STEP_IDS.map((id) => (
          <GuideStep key={id} id={id} progress={progress} skipped={skipped.has(id)} />
        ))}
      </ol>
      {progress.current === null ? <Finished /> : null}
    </aside>
  );
}

function GuideStep(props: {
  readonly id: FirstJobStepId;
  readonly progress: FirstJobProgress;
  readonly skipped: boolean;
}): JSX.Element {
  const step = FIRST_JOB_STEPS[props.id];
  const done = props.progress.done[props.id];
  const current = props.progress.current === props.id;
  const state = done ? 'done' : current ? 'current' : props.skipped ? 'skipped' : 'waiting';
  return (
    <li
      className="lf-first-job__step"
      data-state={state}
      aria-current={current ? 'step' : undefined}
      aria-label={`${step.title}: ${STATE_WORDS[state]}`}
    >
      <span className="lf-first-job__mark" aria-hidden="true">
        {done ? <Icon name="check" size={14} /> : FIRST_JOB_STEP_IDS.indexOf(props.id) + 1}
      </span>
      <div className="lf-first-job__body">
        <strong>{step.title}</strong>
        {done ? <p className="lf-first-job__done">{step.done}</p> : null}
        {props.skipped && !done ? <p className="lf-first-job__done">Skipped.</p> : null}
        {current ? <CurrentStep id={props.id} /> : null}
      </div>
    </li>
  );
}

const STATE_WORDS = {
  done: 'done',
  current: 'current step',
  skipped: 'skipped',
  waiting: 'not yet',
} as const;

function CurrentStep(props: { readonly id: FirstJobStepId }): JSX.Element {
  const step = FIRST_JOB_STEPS[props.id];
  const skip = useFirstJobGuideStore((state) => state.skip);
  return (
    <>
      <p className="lf-first-job__instruction">{step.instruction}</p>
      <div className="lf-first-job__actions">
        {step.target === undefined ? null : (
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            title={`Open the panel at ${step.targetLabel} and put the focus on it. It does not press it.`}
            onClick={() => {
              if (step.target !== undefined)
                revealSearchTarget(step.target, step.targetLabel ?? '');
            }}
          >
            Show me {step.targetLabel}
          </button>
        )}
        {props.id === 'artwork' ? <SampleCircleButton /> : null}
        {step.skippable ? (
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            title="Go on without this step. The guide still waits for Frame and Start."
            onClick={() => skip(props.id)}
          >
            Skip this step
          </button>
        ) : null}
      </div>
    </>
  );
}

function SampleCircleButton(): JSX.Element {
  const drawShape = useStore((state) => state.drawShape);
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      title="Add a 40 mm circle in the middle of the bed. Undo removes it."
      onClick={() => {
        const { project } = useStore.getState();
        const { bedWidth, bedHeight } = project.device;
        drawShape(
          createEllipse({
            id: crypto.randomUUID(),
            color: currentDrawingColor(project),
            spec: { widthMm: SAMPLE_DIAMETER_MM, heightMm: SAMPLE_DIAMETER_MM },
            transform: {
              ...IDENTITY_TRANSFORM,
              x: (bedWidth - SAMPLE_DIAMETER_MM) / 2,
              y: (bedHeight - SAMPLE_DIAMETER_MM) / 2,
            },
          }),
        );
      }}
    >
      Add a sample circle
    </button>
  );
}

function Finished(): JSX.Element {
  const startOver = useFirstJobGuideStore((state) => state.startOver);
  const close = useFirstJobGuideStore((state) => state.closeGuide);
  return (
    <div className="lf-first-job__finished" role="status">
      <p>
        Your first job is under way. Stay with the laser until it finishes; ABORT JOB stops it at
        once. Let the work cool before you lift it out.
      </p>
      <div className="lf-first-job__actions">
        <button type="button" className="lf-btn lf-btn--primary" onClick={close}>
          Close the guide
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--ghost"
          title="Clear skipped steps and follow the guide again for another job"
          onClick={startOver}
        >
          Start over
        </button>
      </div>
    </div>
  );
}

// The current step's real control glows (first-job-guide.css) while the guide
// is open. Presentation only: a body attribute, removed on close.
function useHighlight(target: string | undefined): void {
  useEffect(() => {
    if (target === undefined) return undefined;
    document.body.dataset['firstJobTarget'] = target;
    return () => {
      delete document.body.dataset['firstJobTarget'];
    };
  }, [target]);
}
