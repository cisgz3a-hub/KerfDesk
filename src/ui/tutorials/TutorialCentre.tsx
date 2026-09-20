import { useState } from 'react';
import { useStore } from '../state/store';
import { useTutorialStore } from './tutorial-store';
import { useTutorialProgress } from './tutorial-progress';
import { findTutorial } from './tutorial-catalog';
import { TutorialLibrary } from './TutorialLibrary';
import { TutorialReader } from './TutorialReader';
import type { TutorialCategory, TutorialMachine } from './tutorial-types';

export default function TutorialCentre(): JSX.Element {
  const tutorialId = useTutorialStore((state) => state.tutorialId);
  const machineKind = useStore((state) => state.project.machine?.kind ?? 'laser');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TutorialCategory | 'All'>('All');
  const [machine, setMachine] = useState<TutorialMachine>(machineKind);
  const { progress, remember } = useTutorialProgress();
  const chooseCategory = (value: TutorialCategory | 'All'): void => {
    setCategory(value);
    if (value === 'CNC' && machine === 'laser') setMachine('cnc');
    if (value === 'Laser' && machine === 'cnc') setMachine('laser');
  };
  const chooseMachine = (value: TutorialMachine): void => {
    setMachine(value);
    if ((value === 'laser' && category === 'CNC') || (value === 'cnc' && category === 'Laser'))
      setCategory('All');
  };
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
  return (
    <TutorialLibrary
      query={query}
      setQuery={setQuery}
      category={category}
      setCategory={chooseCategory}
      machine={machine}
      setMachine={chooseMachine}
      progress={progress}
    />
  );
}
