import { useState } from 'react';
import { useTutorialStore } from './tutorial-store';
import { useTutorialProgress } from './tutorial-progress';
import { findTutorial } from './tutorial-catalog';
import { TutorialLibrary } from './TutorialLibrary';
import { TutorialReader } from './TutorialReader';
import type { TutorialCategory } from './tutorial-types';

export default function TutorialCentre(): JSX.Element {
  const tutorialId = useTutorialStore((state) => state.tutorialId);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<TutorialCategory | null>(null);
  const { progress, remember } = useTutorialProgress();
  const tutorial = findTutorial(tutorialId);
  if (tutorial !== undefined) {
    return (
      <TutorialReader
        key={tutorial.id}
        tutorial={tutorial}
        progress={progress[tutorial.id]}
        remember={remember}
      />
    );
  }
  return <TutorialLibrary query={query} setQuery={setQuery} topic={topic} setTopic={setTopic} />;
}
