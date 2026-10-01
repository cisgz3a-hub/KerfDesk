import { activeEdition, proFeaturesUnlocked } from '../licensing/edition';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import type { SafeRemoteAppStatus } from '../remote-control/types';

/** Project only these public fields. The edition object also holds the full licence key. */
export function remoteAppStatus(): SafeRemoteAppStatus {
  const edition = activeEdition();
  const status = edition.status;
  const update = useCommercialUpdateStore.getState().status;
  const mode = !proFeaturesUnlocked()
    ? 'free'
    : !edition.licensed
      ? 'preview'
      : status?.tier === 'trial'
        ? 'trial'
        : 'pro';
  return {
    app: {
      name: 'KerfDesk',
      version: update?.currentVersion ?? __APP_VERSION__,
      platform: 'desktop',
    },
    edition: {
      mode,
      ...(status?.tier === 'trial' && status.accessExpiresAt !== null
        ? { trialEndsAt: status.accessExpiresAt }
        : {}),
    },
    updates: remoteUpdates(),
  };
}
function remoteUpdates(): SafeRemoteAppStatus['updates'] {
  const update = useCommercialUpdateStore.getState().status;
  if (update === null) return { available: false };
  return {
    available: update.state === 'available' || update.state === 'ready',
    ...(update.version === null ? {} : { version: update.version }),
    ...(update.releaseNotes === undefined ? {} : { highlights: update.releaseNotes }),
  };
}
