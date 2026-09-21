import { searchTutorials } from './tutorial-catalog';
import { useTutorialStore } from './tutorial-store';
import type { TutorialProgress } from './tutorial-progress';
import {
  TUTORIAL_CATEGORIES,
  type Tutorial,
  type TutorialCategory,
  type TutorialMachine,
} from './tutorial-types';
import { TutorialStart } from './TutorialStart';

type LibraryProps = {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly category: TutorialCategory | 'All';
  readonly setCategory: (category: TutorialCategory | 'All') => void;
  readonly machine: TutorialMachine;
  readonly setMachine: (machine: TutorialMachine) => void;
  readonly progress: TutorialProgress;
};

const MACHINE_NAMES: Readonly<Record<TutorialMachine, string>> = {
  all: 'All machines',
  laser: 'Laser',
  cnc: 'CNC router',
};

export function TutorialLibrary(props: LibraryProps): JSX.Element {
  const results = searchTutorials(props.query, props.category, props.machine);
  // The same search with the machine filter released, so the list can say what
  // it is hiding instead of quietly disagreeing with the progress count.
  const everyMachine = searchTutorials(props.query, props.category, 'all');
  const hidden = everyMachine.length - results.length;
  const browsing = props.query !== '' || props.category !== 'All';
  return (
    <div className="lf-learn-library">
      {browsing ? null : <TutorialStart progress={props.progress} />}
      <Filters {...props} />
      <div className="lf-learn-results-heading">
        <h2>{props.category === 'All' ? 'Every lesson' : props.category}</h2>
        <span role="status">
          {results.length} {results.length === 1 ? 'lesson' : 'lessons'}
          {hidden > 0 ? (
            <>
              {' · '}
              <button
                type="button"
                className="lf-learn-inline-link"
                title="Include lessons for the other machine type"
                onClick={() => props.setMachine('all')}
              >
                {hidden} more for other machines
              </button>
            </>
          ) : null}
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

function Filters(props: LibraryProps): JSX.Element {
  return (
    <>
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
            {(['all', 'laser', 'cnc'] as const).map((kind) => (
              <option key={kind} value={kind}>
                {MACHINE_NAMES[kind]}
              </option>
            ))}
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
    </>
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

function TutorialCard(props: {
  readonly tutorial: Tutorial;
  readonly progress: { readonly step: number; readonly completed: boolean } | undefined;
}): JSX.Element {
  const { tutorial, progress } = props;
  const done = progress?.completed === true;
  return (
    <button
      type="button"
      className="lf-learn-card"
      data-done={done ? 'yes' : undefined}
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
        <span className={done ? 'lf-learn-completed' : ''}>
          {done
            ? '✓ Completed'
            : progress !== undefined
              ? `Continue · step ${progress.step + 1} of ${tutorial.steps.length} →`
              : `${tutorial.steps.length} steps →`}
        </span>
      </span>
    </button>
  );
}
