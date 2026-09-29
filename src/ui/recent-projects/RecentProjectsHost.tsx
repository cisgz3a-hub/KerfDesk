// Recent Projects and operating-system opens (ADR-378), mounted once with the
// app's banners: loads the list, takes the project files the operating
// system hands over, and hosts the waiting-file banner and the manager.

import { useEffect } from 'react';
import { usePlatformOptional } from '../app/platform-context';
import { appProjectOpenDeps } from './dropped-project-open';
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
    return subscribeExternalProjectOpens(source, appProjectOpenDeps(platform));
  }, [platform]);

  if (platform === null) return null;
  return (
    <>
      <PendingProjectOpenBanner platform={platform} />
      {dialogOpen ? <RecentProjectsDialog platform={platform} /> : null}
    </>
  );
}
