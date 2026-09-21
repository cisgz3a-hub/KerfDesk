import { useEffect, useRef, useState } from 'react';
import { useTutorialStore } from './tutorial-store';
import type { Tutorial } from './tutorial-types';
import { TutorialExample } from './TutorialExample';
import { TUTORIAL_PHOTOS } from './tutorial-photos';

type ReaderProps = {
  readonly tutorial: Tutorial;
  readonly progress: { readonly step: number; readonly completed: boolean } | undefined;
  readonly remember: (id: string, step: number, completed?: boolean) => void;
};

export function TutorialReader({ tutorial, progress, remember }: ReaderProps): JSX.Element {
  const [stepIndex, setStepIndex] = useState(
    progress?.completed === true ? 0 : Math.min(progress?.step ?? 0, tutorial.steps.length - 1),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const step = tutorial.steps[stepIndex] ?? tutorial.steps[0];
  const phase = step.examplePhase ?? Math.min(stepIndex, 2);
  const go = (index: number): void => {
    setStepIndex(index);
    remember(tutorial.id, index);
  };
  useEffect(() => {
    // Let the enclosing dialog capture its opener before moving focus to the step.
    const frame = window.requestAnimationFrame(() => heading.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [stepIndex]);

  return (
    <div
      className="lf-learn-reader"
      onKeyDown={(event) => navigateWithArrow(event, stepIndex, tutorial.steps.length, go)}
    >
      <div className="lf-learn-reading">
        <h1 className="lf-learn-lesson-heading">{tutorial.title}</h1>
        <div className="lf-learn-step-detail">
          <p className="lf-learn-step-count">
            Step {stepIndex + 1} of {tutorial.steps.length}
          </p>
          <h2 ref={heading} tabIndex={-1}>
            {step.title}
          </h2>
          <p className="lf-learn-instruction">{step.instruction}</p>
        </div>
        <TutorialExample
          key={`${tutorial.id}-${stepIndex}`}
          tutorialId={tutorial.id}
          visual={step.visual ?? tutorial.visual}
          phase={phase}
          focus={step.focus}
        />
        <p className="lf-learn-result">
          <strong>Look for:</strong> {step.result}
        </p>
        <LessonNotes key={stepIndex} tutorial={tutorial} phase={phase} />
      </div>
      <nav className="lf-learn-navigation" aria-label="Tutorial steps">
        <button
          type="button"
          className="lf-btn"
          title="Read the previous step"
          disabled={stepIndex === 0}
          onClick={() => go(stepIndex - 1)}
        >
          Back
        </button>
        {stepIndex < tutorial.steps.length - 1 ? (
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            title="Read the next step"
            onClick={() => go(stepIndex + 1)}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            title="Finish tutorial and return to your work"
            onClick={() => {
              remember(tutorial.id, stepIndex, true);
              useTutorialStore.getState().closeTutorial();
            }}
          >
            Done
          </button>
        )}
      </nav>
    </div>
  );
}

function navigateWithArrow(
  event: React.KeyboardEvent<HTMLDivElement>,
  stepIndex: number,
  count: number,
  go: (index: number) => void,
): void {
  if (
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))
  )
    return;
  const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  const target = stepIndex + direction;
  if (direction === 0 || target < 0 || target >= count) return;
  event.preventDefault();
  go(target);
}

function LessonNotes({
  tutorial,
  phase,
}: {
  readonly tutorial: Tutorial;
  readonly phase: number;
}): JSX.Element {
  const photo = TUTORIAL_PHOTOS[tutorial.id];
  const photoNote = photo?.frames[phase]?.caption ?? photo?.frames[0].caption;
  return (
    <details className="lf-learn-notes">
      <summary tabIndex={0}>More help</summary>
      <dl>
        <dt>Where to find it</dt>
        <dd>{tutorial.location}</dd>
        <dt>Before you start</dt>
        <dd>{tutorial.prerequisites}</dd>
        <dt>Tip</dt>
        <dd>{tutorial.tip}</dd>
        {photoNote === undefined ? null : (
          <>
            <dt>About the picture</dt>
            <dd>{photoNote} This is an illustrated example.</dd>
          </>
        )}
      </dl>
    </details>
  );
}
