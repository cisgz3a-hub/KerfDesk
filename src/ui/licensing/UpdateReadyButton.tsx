// The status bar's Update ready button (ADR-547). A licensed desktop app
// downloads a new version in the background and installs it when KerfDesk
// closes; this makes that visible without a pop-up. It opens Help > Check for
// Updates and never restarts or closes anything itself.

import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { CHECK_UPDATES_EVENT } from './update-status-text';

export function UpdateReadyButton(): JSX.Element {
  const status = useCommercialUpdateStore((state) => state.status);
  const version = status?.state === 'ready' ? status.version : null;
  return (
    <>
      {/* Mounted while empty so the reader hears the text change (see PwaUpdateButton). */}
      <span role="status" style={visuallyHiddenStyle}>
        {version === null
          ? ''
          : `KerfDesk ${version} is ready and installs when you close KerfDesk.`}
      </span>
      {version !== null && (
        <button
          type="button"
          className="lf-btn lf-btn--ghost"
          style={buttonStyle}
          onClick={() => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))}
          title={`KerfDesk ${version} installs when you close KerfDesk. Open Check for Updates`}
          aria-label={`Update ready: KerfDesk ${version}. Open Check for Updates`}
        >
          Update ready
        </button>
      )}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '1px 10px',
  whiteSpace: 'nowrap',
};

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};
