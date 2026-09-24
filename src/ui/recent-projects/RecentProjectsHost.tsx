// Recent Projects and operating-system opens (ADR-378), mounted once with the
// app's banners: loads the list, takes the project files the operating
// system hands over, and hosts the waiting-file banner and the manager.

import { useEffect } from 'react';
import { usePlatformOptional } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { subscribeExternalProjectOpens } from './external-project-open';
import { PendingProjectOpenBanner } from './PendingProjectOpenBanner';
import { RecentProjectsDialog } from './RecentProjectsDialog';
import { useRecentProjectsStore } from './recent-projects-store';

export function RecentProjectsHost(): JSX.Element | null {
  const platform = usePlatformOptional();
  const dialogOpen = useRecentProjectsStore((state) => state.dialogOpen);

  useEffect(() => {
    void useRecentProjectsStore
      .getState()
      .refresh()
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const source = platform?.externalFileOpens;
    if (platform === null || source === undefined) return undefined;
    return subscribeExternalProjectOpens(source, {
      platform,
      pushToast: (message, variant) => useToastStore.getState().pushToast(message, variant),
      jobActive: () => isActiveJob(useLaserStore.getState().streamer),
      dialogOpen: () => useUiStore.getState().modalDepth > 0,
    });
  }, [platform]);

  if (platform === null) return null;
  return (
    <>
      <PendingProjectOpenBanner platform={platform} />
      {dialogOpen ? <RecentProjectsDialog platform={platform} /> : null}
    </>
  );
}
