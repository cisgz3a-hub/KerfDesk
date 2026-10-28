import { Button } from '../kit';
import { useStore } from '../state';
import { openedMachineNoticeWords } from './opened-machine-notice-words';

export function ProjectBedReconciliationBanner(): JSX.Element | null {
  const notice = useStore((state) => state.projectBedReconciliation);
  const accept = useStore((state) => state.acceptOpenedProjectMachine);
  const keepCurrent = useStore((state) => state.keepCurrentMachineForOpenedProject);
  if (notice === null) return null;
  // Keeping the current machine is the safe choice for another bed size of
  // the same machine (ADR-440 Amendment 5), so it leads there.
  const keepFirst = notice.sameProfile;
  return (
    <section role="status" aria-label="Opened project machine disclosure" style={bannerStyle}>
      <span>
        <strong>Opened project machine:</strong>
        {openedMachineNoticeWords(notice)}
      </span>
      <span style={actionsStyle}>
        {keepFirst ? (
          <>
            <Button variant="primary" onClick={keepCurrent}>
              Keep current machine
            </Button>
            <Button onClick={accept}>Use project machine</Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={accept}>
              Use project machine
            </Button>
            <Button onClick={keepCurrent}>Keep current machine</Button>
          </>
        )}
      </span>
    </section>
  );
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-warning-border)',
  background: 'var(--lf-warning-bg)',
  color: 'var(--lf-text)',
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexShrink: 0,
};
