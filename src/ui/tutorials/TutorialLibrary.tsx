import { useEffect, useRef } from 'react';
import { searchTutorials, TUTORIALS } from './tutorial-catalog';
import { useTutorialStore } from './tutorial-store';
import { TUTORIAL_CATEGORIES, type Tutorial, type TutorialCategory } from './tutorial-types';

type LibraryProps = {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly topic: TutorialCategory | null;
  readonly setTopic: (topic: TutorialCategory | null) => void;
};

export function TutorialLibrary({ query, setQuery, topic, setTopic }: LibraryProps): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  const searching = query.trim().length > 0;
  const results = searchTutorials(query, 'All', 'all');
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => heading.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="lf-learn-library">
      <h1 ref={heading} tabIndex={-1}>
        Tutorials
      </h1>
      <p className="lf-learn-intro">Choose a topic. Follow a few simple steps.</p>
      <label className="lf-learn-search">
        Search tutorials
        <input
          type="search"
          value={query}
          title="Search tutorials by tool, setting, or task"
          placeholder="Search for a tool or task"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {searching ? (
        <div className="lf-learn-search-results">
          <p className="lf-learn-results-count" role="status">
            {results.length} {results.length === 1 ? 'tutorial' : 'tutorials'} found
          </p>
          {results.length > 0 ? (
            <LessonList tutorials={results} />
          ) : (
            <div className="lf-learn-empty">
              <h2>No matching tutorials</h2>
              <p>Try another tool name, such as text or trace.</p>
              <button
                type="button"
                className="lf-btn"
                title="Clear tutorial search"
                onClick={() => setQuery('')}
              >
                Clear search
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            className="lf-learn-start"
            title="Open tutorial: Make your first project"
            onClick={() => useTutorialStore.getState().openTutorial('first-project')}
          >
            <span>
              <strong>Make your first project</strong>
            </span>
            <span aria-hidden="true">→</span>
          </button>
          <TutorialTopics topic={topic} setTopic={setTopic} />
        </>
      )}
    </div>
  );
}

function TutorialTopics({
  topic,
  setTopic,
}: Pick<LibraryProps, 'topic' | 'setTopic'>): JSX.Element {
  return (
    <div className="lf-learn-topics">
      {TUTORIAL_CATEGORIES.map((category) => (
        <details className="lf-learn-topic" key={category} open={topic === category}>
          <summary
            tabIndex={0}
            title={`Show or hide ${category.toLowerCase()} tutorials`}
            onClick={(event) => {
              event.preventDefault();
              setTopic(topic === category ? null : category);
            }}
          >
            {category}
          </summary>
          {topic === category ? (
            <LessonList
              tutorials={TUTORIALS.filter((tutorial) => tutorial.category === category)}
            />
          ) : null}
        </details>
      ))}
    </div>
  );
}

function LessonList({ tutorials }: { readonly tutorials: readonly Tutorial[] }): JSX.Element {
  return (
    <ul className="lf-learn-lessons">
      {tutorials.map((tutorial) => (
        <li key={tutorial.id}>
          <button
            type="button"
            className="lf-learn-lesson-link"
            title={`Open tutorial: ${tutorial.title}`}
            onClick={() => useTutorialStore.getState().openTutorial(tutorial.id)}
          >
            <span>{tutorial.title}</span>
            <span aria-hidden="true">→</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
