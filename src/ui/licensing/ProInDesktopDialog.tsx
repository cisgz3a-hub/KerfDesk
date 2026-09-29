import { Button, Dialog, DialogActions } from '../kit';
import { DESKTOP_DOWNLOAD_URL } from './edition-policy';
import { licenceMuted } from './LicenceControls';
import { PRO_FEATURES, PRO_PRICE_LABEL, type ProFeature } from './pro-features';

/**
 * A build that cannot take a licence runs KerfDesk Free once sales open
 * (ADR-544). Its Pro tools, its status bar notice and Help > Licence all point
 * to the desktop app, where Pro is unlocked, and list every Pro feature.
 */
export function ProInDesktopDialog({
  feature,
  onClose,
}: {
  /** The Pro tool that was asked for, or 'all' for the notice itself. */
  readonly feature: ProFeature | 'all';
  readonly onClose: () => void;
}): JSX.Element {
  const tool = feature === 'all' ? null : PRO_FEATURES[feature];
  return (
    <Dialog
      size="sm"
      title={tool === null ? 'Pro is in the desktop app' : `${tool.name} is a Pro tool`}
      onClose={onClose}
    >
      {tool === null ? null : <p style={bodyStyle}>{tool.summary}</p>}
      <p style={bodyStyle}>All Pro features are in the KerfDesk desktop app for Windows:</p>
      <ul style={listStyle} aria-label="Pro features">
        {Object.values(PRO_FEATURES).map((pro) => (
          <li key={pro.name}>{pro.name}</li>
        ))}
      </ul>
      <p style={bodyStyle}>
        Try every Pro tool free for 30 days there, or buy Pro for {PRO_PRICE_LABEL} once.
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
const listStyle: React.CSSProperties = {
  margin: '0 0 10px',
  paddingLeft: 20,
  columns: 2,
  fontSize: 13,
  lineHeight: 1.6,
};
const linkStyle: React.CSSProperties = { textDecoration: 'none' };
