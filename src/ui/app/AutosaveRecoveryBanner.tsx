import { Button } from '../kit';
import { useAutosaveRecovery } from './use-autosave-recovery';

export function AutosaveRecoveryBanner(): JSX.Element | null {
  const offer = useAutosaveRecovery();
  if (offer === null) return null;
  return (
    <section aria-label="Autosaved project" style={bannerStyle}>
      <span>Autosaved project available · {offer.ageLabel}</span>
      <span style={actionsStyle}>
        <Button variant="primary" onClick={offer.restore}>
          Restore
        </Button>
        <Button onClick={offer.hide} title="Hide this reminder and keep the autosave">
          Hide
        </Button>
      </span>
    </section>
  );
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  padding: '4px 12px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexShrink: 0,
};
