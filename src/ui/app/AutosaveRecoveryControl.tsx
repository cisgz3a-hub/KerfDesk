import { useCallback, useId, useRef, useState } from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { Button, Icon } from '../kit';
import { useAutosaveRecovery } from './use-autosave-recovery';
import './autosave-recovery.css';

export function AutosaveRecoveryControl(): JSX.Element | null {
  const offer = useAutosaveRecovery();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  if (offer === null) return null;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="lf-btn lf-btn--ghost lf-autosave-recovery__trigger"
        aria-label="Recover autosave"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="An autosaved project is available. Review restore options."
        onClick={() => setOpen((value) => !value)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !document.getElementById(panelId)?.contains(next)) close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <Icon name="undo" size={14} />
        <span>Recover autosave</span>
      </button>
      {open && (
        <AnchoredPopover
          id={panelId}
          label="Autosaved project"
          role="dialog"
          anchorRef={anchorRef}
          className="lf-autosave-recovery__panel"
          closeOnTab={false}
          onClose={close}
        >
          <strong>Autosaved project</strong>
          <p>Saved {offer.ageLabel}. Restore it to continue where you left off.</p>
          <div className="lf-autosave-recovery__actions">
            <Button variant="primary" onClick={offer.restore}>
              Restore
            </Button>
            <Button onClick={offer.hide} title="Hide this reminder and keep the autosave">
              Hide
            </Button>
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
