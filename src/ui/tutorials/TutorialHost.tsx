import { lazy, Suspense, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { useRegisterModal } from '../common/use-register-modal';
import { useTutorialStore } from './tutorial-store';
import './tutorials.css';

const TutorialCentre = lazy(() => import('./TutorialCentre'));

export function TutorialHost(): JSX.Element | null {
  const isOpen = useTutorialStore((state) => state.isOpen);
  return isOpen ? createPortal(<TutorialShell />, document.body) : null;
}

function TutorialShell(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const close = useTutorialStore((state) => state.closeTutorial);
  const open = useTutorialStore((state) => state.openTutorial);
  const tutorialId = useTutorialStore((state) => state.tutorialId);
  const goBack = useTutorialStore((state) => state.goBack);
  useRegisterModal();
  useDialogA11y(ref, tutorialId === null ? close : goBack, { initialFocus: 'surface' });
  return (
    <div
      className="lf-learn-backdrop"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="KerfDesk visual tutorials"
      tabIndex={-1}
    >
      <section className="lf-learn">
        <header className="lf-learn-header">
          {tutorialId === null ? (
            <span className="lf-learn-brand">KerfDesk</span>
          ) : (
            <button
              type="button"
              className="lf-btn lf-btn--ghost"
              title="Return to the tutorial library"
              onClick={() => open()}
            >
              ← All tutorials
            </button>
          )}
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            title="Close tutorials and return to your work"
            aria-label="Close tutorials"
            onClick={close}
          >
            Close
          </button>
        </header>
        <Suspense
          fallback={
            <p className="lf-learn-loading" role="status">
              Opening visual tutorials…
            </p>
          }
        >
          <TutorialCentre />
        </Suspense>
      </section>
    </div>
  );
}
