// ADR-688: unsaved work from the last session is offered on the canvas, where
// a returning beginner looks, not as a link in the status bar (#1137). The
// card blocks nothing and takes no focus. Restore loads the work; Start fresh
// keeps the autosave, which File > Recover unsaved work still lists, and any
// edit or new document retires the card the same way.

import { useMemo } from 'react';
import { Button } from '../kit';
import { usePlatformOptional } from './platform-context';
import { useAutosaveRecovery } from './use-autosave-recovery';
import { recoveryObjectSummary, recoveryThumbnail } from './autosave-recovery-summary';
import './autosave-recovery.css';

export function AutosaveRecoveryCard(): JSX.Element | null {
  const offer = useAutosaveRecovery();
  const platform = usePlatformOptional();
  const project = offer?.project;
  const thumbnail = useMemo(
    () => (project === undefined ? null : recoveryThumbnail(project)),
    [project],
  );
  if (offer === null) return null;
  const where = platform?.id === 'electron' ? 'on this computer' : 'in this browser';
  return (
    <section
      className="lf-autosave-recovery"
      aria-labelledby="lf-autosave-recovery-title"
      data-autosave-recovery-card=""
    >
      <h2 id="lf-autosave-recovery-title" className="lf-autosave-recovery__title">
        Your last session wasn&apos;t saved. Restore it?
      </h2>
      <div className="lf-autosave-recovery__body">
        {thumbnail === null ? null : (
          <img className="lf-autosave-recovery__thumbnail" src={thumbnail} alt="" />
        )}
        <p>
          {recoveryObjectSummary(offer.project)}, autosaved {offer.ageLabel} {where}.
        </p>
      </div>
      <div className="lf-autosave-recovery__actions">
        <Button variant="primary" onClick={offer.restore}>
          Restore
        </Button>
        <Button
          onClick={offer.startFresh}
          title="Keep the autosave and start on an empty canvas. File > Recover unsaved work brings it back later."
        >
          Start fresh
        </Button>
      </div>
      <p className="lf-autosave-recovery__hint">
        Start fresh keeps it under File &gt; Recover unsaved work.
      </p>
    </section>
  );
}
