// The service worker registers only on the web target. On the desktop shell the
// app runs on the app:// scheme, where Chromium refuses SW registration — so
// mounting PwaUpdateWatcher there only logs a per-launch registration error and
// exposes a second, redundant update path that could let a cached precache mask
// electron-updater's on-disk swap. Gate the MOUNT here: a hook can't be called
// conditionally, so PwaUpdateWatcher (which calls useRegisterSW at its top)
// cannot self-gate. A null platform — no provider, e.g. isolated unit tests —
// is treated as web so browser update readiness still publishes (ELE-06;
// ADR-024/ADR-060: SW registration is web-only). Reads adapter.id via platform
// context, respecting the ui←platform/types boundary (not platform/electron
// directly).

import { usePlatformOptional } from './platform-context';
import { PwaUpdateWatcher } from './PwaUpdateWatcher';

const DESKTOP_PLATFORM_ID = 'electron';

export function PwaUpdateWatcherGate(): JSX.Element | null {
  const platform = usePlatformOptional();
  if (platform?.id === DESKTOP_PLATFORM_ID) return null;
  return <PwaUpdateWatcher />;
}
