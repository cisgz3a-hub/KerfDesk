import { Button, Dialog, DialogActions } from '../kit';
import { DESKTOP_DOWNLOAD_URL } from './edition-policy';
import { licenceMuted } from './LicenceControls';
import { PRO_FEATURES, PRO_PRICE_LABEL, type ProFeature } from './pro-features';

/**
 * A build that cannot take a licence runs KerfDesk Free once sales open
 * (ADR-544). Its Pro tools point to the desktop app, where Pro is unlocked.
 */
export function ProInDesktopDialog({
  feature,
  onClose,
}: {
  readonly feature: ProFeature;
  readonly onClose: () => void;
}): JSX.Element {
  const tool = PRO_FEATURES[feature];
  return (
    <Dialog size="sm" title={`${tool.name} is a Pro tool`} onClose={onClose}>
      <p style={bodyStyle}>{tool.summary}</p>
      <p style={bodyStyle}>
        Pro tools come with KerfDesk Pro in the desktop app for Windows. Try every Pro tool free for
        30 days there, or buy Pro for {PRO_PRICE_LABEL} once.
      </p>
      <DialogActions>
        <a
          className="lf-btn lf-btn--primary"
          style={linkStyle}
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
        >
          Get KerfDesk Pro
        </a>
        <Button onClick={onClose}>Not now</Button>
      </DialogActions>
      <p style={licenceMuted}>
        Everything else in KerfDesk stays free, and a licence never stops a job that is running.
      </p>
    </Dialog>
  );
}

const bodyStyle: React.CSSProperties = { margin: '0 0 10px', fontSize: 13, lineHeight: 1.5 };
const linkStyle: React.CSSProperties = { textDecoration: 'none' };
