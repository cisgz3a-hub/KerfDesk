import { Button } from '../kit';
import { useStore } from '../state';
import {
  noticeBannerActionsStyle,
  noticeBannerStyle,
  noticeBannerTextStyle,
} from './notice-banner-style';
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
    <section role="status" aria-label="Opened project machine disclosure" style={noticeBannerStyle}>
      <span style={noticeBannerTextStyle}>
        <strong>Opened project machine:</strong>
        {openedMachineNoticeWords(notice)}
      </span>
      <span style={noticeBannerActionsStyle}>
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
