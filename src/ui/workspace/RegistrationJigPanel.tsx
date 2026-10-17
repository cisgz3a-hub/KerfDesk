// Compact main-workspace controls; the editor is a separate lazy-loaded canvas.
import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import {
  findRegistrationBoxes,
  hasRegistrationArtwork,
  registrationRunState,
} from '../../core/scene';
import { Button } from '../kit';
import { useEdition } from '../licensing/edition';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import './registration-jig/registration-jig.css';

const JigEditor = lazy(() =>
  import('./registration-jig/RegistrationJigEditor').then((module) => ({
    default: module.RegistrationJigEditor,
  })),
);

export function RegistrationJigPanel(): JSX.Element | null {
  const { requestPro } = useEdition();
  const open = useUiStore((state) => state.registrationPanelOpen);
  const close = useUiStore((state) => state.closeRegistrationPanel);
  const edit = useUiStore((state) => state.openRegistrationPanel);
  const scene = useStore((state) => state.project.scene);
  const setOutput = useStore((state) => state.setRegistrationOutput);
  const boxes = findRegistrationBoxes(scene);
  const hasJig = boxes.length > 0 && !boxes.some((box) => box.provenance === 'captured-board');
  const mode = registrationRunState(scene);
  return (
    <>
      {hasJig && (
        <section className="lf-jig-bar" aria-label="Registration jig controls">
          <strong>Registration Jig</strong>
          <Button onClick={() => requestPro('registration-jig', edit)}>Edit jig</Button>
          <Button pressed={mode === 'box'} onClick={() => setOutput('box')}>
            Outline only
          </Button>
          <Button
            pressed={mode === 'artwork'}
            disabled={!hasRegistrationArtwork(scene)}
            onClick={() => setOutput('artwork')}
          >
            Artwork only
          </Button>
          <span role="status">
            {mode === 'box'
              ? 'Next: burn outlines on the base before placing pieces'
              : mode === 'artwork'
                ? 'Next: place pieces and focus on their top surface, then burn artwork'
                : 'Choose an output mode'}
          </span>
          <span className="lf-jig-sequence">
            1. Burn outlines → 2. Place pieces → 3. Focus on top → 4. Burn artwork. Keep the same XY
            position.
          </span>
        </section>
      )}
      {open &&
        createPortal(
          <Suspense
            fallback={
              <div className="lf-jig-editor" role="status">
                Opening Registration Jig…
              </div>
            }
          >
            <JigEditor onClose={close} />
          </Suspense>,
          document.body,
        )}
    </>
  );
}
