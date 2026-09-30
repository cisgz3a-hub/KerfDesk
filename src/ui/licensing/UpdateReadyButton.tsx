// The desktop status bar announces offered and downloaded versions without a
// pop-up. It opens Help > Check for Updates and never closes the app itself.

import type { CommercialUpdateStatus } from '../../platform/types';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { CHECK_UPDATES_EVENT, updateStatusText } from './update-status-text';

export function UpdateReadyButton(): JSX.Element {
  const status = useCommercialUpdateStore((state) => state.status);
  const notice = updateNotice(status);
  return (
    <>
      {/* Mounted while empty so the reader hears the text change (see PwaUpdateButton). */}
      <span role="status" style={visuallyHiddenStyle}>
        {notice?.description ?? ''}
      </span>
      {notice !== null && (
        <button
          type="button"
          className="lf-btn lf-btn--ghost"
          style={buttonStyle}
          onClick={() => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))}
          title={notice.title}
          aria-label={`${notice.label}: KerfDesk ${notice.version}. Open Check for Updates`}
        >
          {notice.label}
        </button>
      )}
    </>
  );
}

function updateNotice(status: CommercialUpdateStatus | null) {
  if (status === null || !['ready', 'available'].includes(status.state) || status.version === null)
    return null;
  const label = status.state === 'available' ? 'Update available' : 'Update ready';
  const description = updateStatusText(status, null);
  const title =
    status.mode === 'manual' || status.state === 'available'
      ? `${description} Open Check for Updates`
      : `KerfDesk ${status.version} installs when you close KerfDesk. Open Check for Updates`;
  return { label, description, title, version: status.version };
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
