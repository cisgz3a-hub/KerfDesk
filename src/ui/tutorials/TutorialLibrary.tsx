import { searchTutorials, TUTORIALS } from './tutorial-catalog';
import { useTutorialStore } from './tutorial-store';
import type { TutorialProgress } from './tutorial-progress';
import {
  TUTORIAL_CATEGORIES,
  type Tutorial,
  type TutorialCategory,
  type TutorialMachine,
} from './tutorial-types';
import { TutorialIllustration } from './TutorialIllustration';

type LibraryProps = {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly category: TutorialCategory | 'All';
  readonly setCategory: (category: TutorialCategory | 'All') => void;
  readonly machine: TutorialMachine;
  readonly setMachine: (machine: TutorialMachine) => void;
  readonly progress: TutorialProgress;
};

export function TutorialLibrary(props: LibraryProps): JSX.Element {
  const results = searchTutorials(props.query, props.category, props.machine);
  const completed = TUTORIALS.filter(
    (tutorial) => props.progress[tutorial.id]?.completed === true,
  ).length;
  return (
    <div className="lf-learn-library">
      <LibraryHero completed={completed} />
      <div className="lf-learn-filters">
        <label className="lf-learn-search">
          Find a tool or a task
          <input
            type="search"
            value={props.query}
            title="Search tutorials by tool, setting, or task"
            placeholder="Try trace, V-carve, text, or camera…"
            onChange={(event) => props.setQuery(event.target.value)}
          />
        </label>
        <label className="lf-learn-machine">
          Machine
          <select
            value={props.machine}
            title="Filter tutorials by machine type"
            onChange={(event) => props.setMachine(event.target.value as TutorialMachine)}
          >
            <option value="all">All machines</option>
            <option value="laser">Laser</option>
            <option value="cnc">CNC router</option>
          </select>
        </label>
      </div>
      <div className="lf-learn-categories" role="group" aria-label="Tutorial categories">
        {(['All', ...TUTORIAL_CATEGORIES] as const).map((category) => (
          <button
            key={category}
            type="button"
            title={`Show ${category.toLowerCase()} tutorials`}
            aria-pressed={props.category === category}
            onClick={() => props.setCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="lf-learn-results-heading">
        <h2>{props.category === 'All' ? 'Explore the tools' : props.category}</h2>
        <span role="status">
          {results.length} {results.length === 1 ? 'lesson' : 'lessons'}
        </span>
      </div>
      <div className="lf-learn-cards">
        {results.map((tutorial) => (
          <TutorialCard
            key={tutorial.id}
            tutorial={tutorial}
            progress={props.progress[tutorial.id]}
          />
        ))}
      </div>
      {results.length === 0 ? <EmptyResults {...props} /> : null}
    </div>
  );
}

function EmptyResults(props: LibraryProps): JSX.Element {
  return (
    <div className="lf-learn-empty">
      <h3>No matching lessons</h3>
      <p>Try a tool name or broaden the category and machine filters.</p>
      <button
        type="button"
        className="lf-btn"
        title="Clear search and all tutorial filters"
        onClick={() => {
          props.setQuery('');
          props.setCategory('All');
          props.setMachine('all');
        }}
      >
        Show all tutorials
      </button>
    </div>
  );
}

function LibraryHero(props: { readonly completed: number }): JSX.Element {
  return (
    <div className="lf-learn-hero">
      <div>
        <span className="lf-learn-eyebrow">YOUR WORKSHOP COMPANION</span>
        <h1>See it. Try it. Make it.</h1>
        <p>
          Get to know each tool through clear, illustrated steps. Start with the basics or jump
          straight to the feature you need.
        </p>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          title="Start the first-project visual tutorial"
          onClick={() => useTutorialStore.getState().openTutorial('first-project')}
        >
          Start your first project <span aria-hidden="true">→</span>
        </button>
        <span className="lf-learn-progress-count">
          {props.completed} of {TUTORIALS.length} lessons completed
        </span>
      </div>
      <div className="lf-learn-hero-art" aria-hidden="true">
        <TutorialIllustration visual="workspace" phase={2} focus="From an idea to a reviewed job" />
      </div>
    </div>
  );
}

function TutorialCard(props: {
  readonly tutorial: Tutorial;
  readonly progress: { readonly step: number; readonly completed: boolean } | undefined;
}): JSX.Element {
  const { tutorial, progress } = props;
  return (
    <button
      type="button"
      className="lf-learn-card"
      title={`Open tutorial: ${tutorial.title}`}
      onClick={() => useTutorialStore.getState().openTutorial(tutorial.id)}
    >
      <span className="lf-learn-card-meta">
        <span>{tutorial.category}</span>
        <span>{tutorial.minutes} min</span>
      </span>
      <strong>{tutorial.title}</strong>
      <span className="lf-learn-card-summary">{tutorial.summary}</span>
      <span className="lf-learn-card-bottom">
        <span>
          {tutorial.machine === 'all'
            ? 'Laser + CNC'
            : tutorial.machine === 'laser'
              ? 'Laser'
              : 'CNC router'}
        </span>
        <span className={progress?.completed === true ? 'lf-learn-completed' : ''}>
          {progress?.completed === true
            ? '✓ Completed'
            : progress !== undefined
              ? 'Continue →'
              : `${tutorial.steps.length} visual steps →`}
        </span>
      </span>
    </button>
  );
}
