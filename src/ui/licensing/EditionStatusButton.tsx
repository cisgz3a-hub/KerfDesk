// The status bar's edition chip (ADR-540). A build that sells licences names
// its edition and opens Help > Licence. Once sales open, a build that cannot take
// a licence says that Pro is in the desktop app (ADR-544). It never gates work.

import type { LicenceStatus } from '../../platform/types';
import { useEdition } from './edition';

const DAY = 86_400;

export function editionLabel(status: LicenceStatus, nowSeconds: number): string {
  if (status.edition === 'pro') {
    if (status.tier === 'trial' && status.accessExpiresAt !== null) {
      const days = Math.max(0, Math.ceil((status.accessExpiresAt - nowSeconds) / DAY));
      return days === 1 ? 'Pro trial · 1 day left' : `Pro trial · ${days} days left`;
    }
    return 'Pro';
  }
  return status.state === 'activation-required' && status.tier === null ? 'Free · Try Pro' : 'Free';
}

export const PRO_IN_DESKTOP_LABEL = 'Free · Pro in the desktop app';

export function EditionStatusButton(): JSX.Element | null {
  const edition = useEdition();
  if (edition.proInDesktop === true)
    return (
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        style={buttonStyle}
        onClick={edition.openLicence}
        title="All Pro features are in the KerfDesk desktop app for Windows. See which ones"
        aria-label={`Edition: ${PRO_IN_DESKTOP_LABEL}. See the Pro features`}
      >
        {PRO_IN_DESKTOP_LABEL}
      </button>
    );
  if (!edition.licensed || edition.status === null) return null;
  const label = editionLabel(edition.status, Math.floor(Date.now() / 1000));
  return (
    <button
      type="button"
      className="lf-btn lf-btn--ghost"
      style={buttonStyle}
      onClick={edition.openLicence}
      title="Open Help > Licence: your edition, the Pro trial, and your licence key and devices"
      aria-label={`Edition: ${label}. Open licence settings`}
    >
      {label}
    </button>
  );
}

const buttonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '1px 10px',
  whiteSpace: 'nowrap',
};
