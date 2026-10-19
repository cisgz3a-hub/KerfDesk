// The main canvas's compact jig bar, and the lazily loaded jig page that takes
// the canvas's place in jig mode (ADR-641).
import { lazy, Suspense } from 'react';
import { findRegistrationBoxes } from '../../core/scene';
import { Button } from '../kit';
import { useEdition } from '../licensing/edition';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { jigRunPhase, type JigRunPhase } from './registration-jig/jig-run-phase';
import './registration-jig/registration-jig.css';

const JigEditor = lazy(() =>
  import('./registration-jig/RegistrationJigEditor').then((module) => ({
    default: module.RegistrationJigEditor,
  })),
);

/** The run order lives in jig mode; the main canvas only says what burns next. */
export function RegistrationJigPanel(): JSX.Element | null {
  const { requestPro } = useEdition();
  const edit = useUiStore((state) => state.openRegistrationPanel);
  const scene = useStore((state) => state.project.scene);
  const boxes = findRegistrationBoxes(scene);
  const hasJig = boxes.length > 0 && !boxes.some((box) => box.provenance === 'captured-board');
  if (!hasJig) return null;
  return (
    <section className="lf-jig-bar" aria-label="Registration jig controls">
      <strong>Registration Jig</strong>
      <Button
        title="Open the jig page to lay out, place and burn the jig"
        onClick={() => requestPro('registration-jig', edit)}
      >
        Edit jig
      </Button>
      <span role="status">{nextBurn(jigRunPhase(scene))}</span>
    </section>
  );
}

function nextBurn(phase: JigRunPhase): string {
  switch (phase) {
    case 'outlines':
      return 'Next burn: outlines, on the empty base';
    case 'artwork':
      return 'Next burn: artwork, on the pieces in the burned outlines';
    case 'both':
      return 'Outlines and artwork are both set to burn. Open the jig to choose one run.';
    case 'none':
      return '';
  }
}

/** Jig mode's page, in the place of the tool strip and the main canvas. */
export function RegistrationJigWorkspace(): JSX.Element {
  const close = useUiStore((state) => state.closeRegistrationPanel);
  return (
    <Suspense
      fallback={
        <div className="lf-jig-editor" role="status">
          Opening Registration Jig…
        </div>
      }
    >
      <JigEditor onClose={close} />
    </Suspense>
  );
}
