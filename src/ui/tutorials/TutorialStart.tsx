// The library's opening panel: one clear next action, honest progress, and
// the starter path as an ordered route rather than six cards adrift in a grid
// of eighty. It yields the whole area as soon as the reader searches or picks
// a category — at that point they have told us what they want.

import { useTutorialStore } from './tutorial-store';
import { countCompleted, resumeLesson, STARTER_PATH } from './tutorial-journey';
import type { TutorialProgress } from './tutorial-progress';
import { TUTORIALS } from './tutorial-catalog';

export function TutorialStart(props: { readonly progress: TutorialProgress }): JSX.Element {
  const resume = resumeLesson(props.progress);
  const done = countCompleted(props.progress);
  const open = (id: string): void => useTutorialStore.getState().openTutorial(id);
  return (
    <div className="lf-learn-start">
      <div className="lf-learn-start-lead">
        <span className="lf-learn-eyebrow">YOUR WORKSHOP COMPANION</span>
        <h1>See it. Try it. Make it.</h1>
        <p>
          Every tool, in a few illustrated steps. Follow the opening path, or search for the one
          feature you came for.
        </p>
        {resume === undefined ? null : (
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            title={`Open the lesson: ${resume.tutorial.title}`}
            onClick={() => open(resume.tutorial.id)}
          >
            {resume.started ? 'Continue' : 'Start'}: {resume.tutorial.title}{' '}
            <span aria-hidden="true">→</span>
          </button>
        )}
        <Progress done={done} />
      </div>
      <ol className="lf-learn-path" aria-label="Opening path">
        {STARTER_PATH.map((tutorial, index) => {
          const state = props.progress[tutorial.id];
          const isDone = state?.completed === true;
          return (
            <li key={tutorial.id}>
              <button
                type="button"
                data-done={isDone ? 'yes' : undefined}
                title={`Open the lesson: ${tutorial.title}`}
                onClick={() => open(tutorial.id)}
              >
                <span className="lf-learn-path-mark" aria-hidden="true">
                  {isDone ? '✓' : index + 1}
                </span>
                <span className="lf-learn-path-name">{tutorial.title}</span>
                <span className="lf-learn-path-state">
                  {isDone
                    ? 'Done'
                    : state === undefined
                      ? `${tutorial.minutes} min`
                      : 'In progress'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Progress(props: { readonly done: number }): JSX.Element {
  const total = TUTORIALS.length;
  const percent = total === 0 ? 0 : Math.round((props.done / total) * 100);
  return (
    <div className="lf-learn-progress">
      <div
        className="lf-learn-progress-bar"
        role="progressbar"
        aria-valuenow={props.done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Lessons completed"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="lf-learn-progress-count">
        {props.done} of {total} lessons completed
      </span>
    </div>
  );
}
