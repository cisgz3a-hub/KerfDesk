import { useEffect, useRef, useState } from 'react';
import { findTutorial } from './tutorial-catalog';
import { useTutorialStore } from './tutorial-store';
import type { Tutorial } from './tutorial-types';
import { TutorialExample } from './TutorialExample';

type ReaderProps = {
  readonly tutorial: Tutorial;
  readonly progress: { readonly step: number; readonly completed: boolean } | undefined;
  readonly remember: (id: string, step: number, completed?: boolean) => void;
};

export function TutorialReader(props: ReaderProps): JSX.Element {
  const { tutorial } = props;
  const [stepIndex, setStepIndex] = useState(
    Math.min(props.progress?.step ?? 0, tutorial.steps.length - 1),
  );
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = tutorial.steps[stepIndex] ?? tutorial.steps[0];
  const go = (index: number): void => {
    setStepIndex(index);
    setFinished(false);
    props.remember(tutorial.id, index);
  };
  useEffect(() => {
    // Child effects run before the enclosing dialog captures its opener.
    const frame = window.requestAnimationFrame(() => heading.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [stepIndex]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // Steps are a sequence; let the keyboard walk it. Typing targets keep
    // their own arrow behaviour (the reader has none today, but the example
    // controls and any future field must not be hijacked).
    if (event.target instanceof HTMLElement && isTypingTarget(event.target)) return;
    const next = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (next === 0) return;
    const target = stepIndex + next;
    if (target < 0 || target >= tutorial.steps.length) return;
    event.preventDefault();
    go(target);
  };
  return (
    <div className="lf-learn-reader" onKeyDown={onKeyDown}>
      <LessonHeading tutorial={tutorial} />
      <div className="lf-learn-lesson-grid">
        <VisualColumn tutorial={tutorial} stepIndex={stepIndex} />
        <div className="lf-learn-step-column">
          <StepList tutorial={tutorial} stepIndex={stepIndex} go={go} />
          <div className="lf-learn-step-detail" aria-live="polite" aria-atomic="true">
            <span className="lf-learn-eyebrow">
              STEP {stepIndex + 1} OF {tutorial.steps.length}
            </span>
            <h2 ref={heading} tabIndex={-1}>
              {step.title}
            </h2>
            <p>{step.instruction}</p>
            <div className="lf-learn-result">
              <strong>What you should see</strong>
              <p>{step.result}</p>
            </div>
          </div>
          <ReaderNavigation
            step={stepIndex}
            count={tutorial.steps.length}
            go={go}
            finished={finished}
            finish={() => {
              props.remember(tutorial.id, stepIndex, true);
              setFinished(true);
            }}
          />
        </div>
      </div>
      <div className="lf-learn-tip">
        <strong>Worth knowing</strong>
        <p>{tutorial.tip}</p>
      </div>
      {finished ? (
        <div role="status" className="lf-learn-done">
          <strong>Lesson complete. Ready when you are.</strong>
          <span>
            Close this lesson to try the steps in your project. You can reopen it at any time.
          </span>
        </div>
      ) : null}
      <RelatedLessons tutorial={tutorial} />
    </div>
  );
}

function VisualColumn({
  tutorial,
  stepIndex,
}: {
  readonly tutorial: Tutorial;
  readonly stepIndex: number;
}): JSX.Element {
  const step = tutorial.steps[stepIndex] ?? tutorial.steps[0];
  return (
    <div className="lf-learn-visual-column">
      <TutorialExample
        key={`${tutorial.id}-${stepIndex}`}
        tutorialId={tutorial.id}
        visual={step.visual ?? tutorial.visual}
        phase={step.examplePhase ?? Math.min(stepIndex, 2)}
        focus={step.focus}
        result={step.result}
      />
      <div className="lf-learn-location">
        <strong>Where to find it</strong>
        <span>{tutorial.location}</span>
      </div>
      <div className="lf-learn-location">
        <strong>Before you start</strong>
        <span>{tutorial.prerequisites}</span>
      </div>
    </div>
  );
}

function LessonHeading({ tutorial }: { readonly tutorial: Tutorial }): JSX.Element {
  const cameFrom = useTutorialStore((state) => state.trail.at(-1));
  const previous = findTutorial(cameFrom ?? null);
  return (
    <>
      <div className="lf-learn-reader-top">
        <button
          type="button"
          className="lf-btn lf-btn--ghost"
          title={
            previous === undefined
              ? 'Return to the tutorial library (Escape)'
              : `Back to ${previous.title} (Escape)`
          }
          onClick={() => useTutorialStore.getState().goBack()}
        >
          ← {previous === undefined ? 'All tutorials' : previous.title}
        </button>
        <span>
          {tutorial.category} <span aria-hidden="true">/</span> {tutorial.minutes} min
        </span>
      </div>
      <div className="lf-learn-lesson-heading">
        <span className="lf-learn-eyebrow">
          {tutorial.machine === 'all'
            ? 'LASER + CNC'
            : tutorial.machine === 'laser'
              ? 'LASER'
              : 'CNC ROUTER'}
        </span>
        <h1>{tutorial.title}</h1>
        <p>{tutorial.summary}</p>
      </div>
    </>
  );
}

function StepList({
  tutorial,
  stepIndex,
  go,
}: {
  readonly tutorial: Tutorial;
  readonly stepIndex: number;
  readonly go: (index: number) => void;
}): JSX.Element {
  return (
    <ol className="lf-learn-step-list" aria-label="Lesson steps">
      {tutorial.steps.map((item, index) => (
        <li key={item.title}>
          <button
            type="button"
            title={`Go to step ${index + 1}: ${item.title}`}
            aria-current={index === stepIndex ? 'step' : undefined}
            onClick={() => go(index)}
          >
            <span>{index + 1}</span>
            {item.title}
          </button>
        </li>
      ))}
    </ol>
  );
}

function ReaderNavigation(props: {
  readonly step: number;
  readonly count: number;
  readonly go: (step: number) => void;
  readonly finish: () => void;
  readonly finished: boolean;
}): JSX.Element {
  return (
    <div className="lf-learn-navigation">
      <button
        type="button"
        className="lf-btn"
        title="Read the previous step"
        disabled={props.step === 0}
        onClick={() => props.go(props.step - 1)}
      >
        Back
      </button>
      {props.step < props.count - 1 ? (
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          title="Read the next step"
          onClick={() => props.go(props.step + 1)}
        >
          Next step →
        </button>
      ) : (
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          title="Mark this lesson complete on this device"
          disabled={props.finished}
          onClick={props.finish}
        >
          {props.finished ? 'Completed ✓' : 'Finish lesson'}
        </button>
      )}
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        title="Restart from step one"
        onClick={() => props.go(0)}
      >
        Restart
      </button>
      <span className="lf-learn-key-hint">
        <kbd>←</kbd> <kbd>→</kbd> steps · <kbd>Esc</kbd> back
      </span>
    </div>
  );
}

function RelatedLessons(props: { readonly tutorial: Tutorial }): JSX.Element {
  return (
    <div className="lf-learn-related">
      <span>Learn next</span>
      {props.tutorial.related.map((id) => {
        const related = findTutorial(id);
        return related === undefined ? null : (
          <button
            type="button"
            key={id}
            className="lf-btn lf-btn--ghost"
            title={`Open related tutorial: ${related.title}`}
            onClick={() => useTutorialStore.getState().openTutorial(id)}
          >
            {related.title} →
          </button>
        );
      })}
    </div>
  );
}

function isTypingTarget(node: HTMLElement): boolean {
  return (
    node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName.toUpperCase())
  );
}
