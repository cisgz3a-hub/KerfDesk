import { lazy, Suspense, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { useRegisterModal } from '../common/use-register-modal';
import { useTutorialStore } from './tutorial-store';
import { TutorialIcon } from './TutorialButton';
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
  useRegisterModal();
  useDialogA11y(ref, close, { initialFocus: 'surface' });
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
          <button
            type="button"
            className="lf-learn-brand"
            title="Browse all visual tutorials"
            onClick={() => open()}
          >
            <TutorialIcon /> KERFDESK <strong>LEARN</strong>
          </button>
          <span className="lf-learn-header-note">One tool. A few clear steps.</span>
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            title="Close tutorials and return to your work (Escape)"
            aria-label="Close tutorials"
            onClick={close}
          >
            Close <kbd>Esc</kbd>
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
        <footer className="lf-learn-footer">
          Illustrated examples · Your project stays as you left it
        </footer>
      </section>
    </div>
  );
}
