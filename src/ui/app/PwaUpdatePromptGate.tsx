// The service worker registers only on the web target. On the desktop shell the
// app runs on the app:// scheme, where Chromium refuses SW registration — so
// mounting PwaUpdatePrompt there only logs a per-launch registration error and
// exposes a second, redundant update path that could let a cached precache mask
// electron-updater's on-disk swap. Gate the MOUNT here: a hook can't be called
// conditionally, so PwaUpdatePrompt (which calls useRegisterSW at its top) cannot
// self-gate. A null platform — no provider, e.g. isolated unit tests — is treated
// as web so the browser update banner still works (ELE-06; ADR-024/ADR-060: SW
// registration is web-only). Reads adapter.id via platform context, respecting
// the ui←platform/types boundary (not platform/electron directly).

import { usePlatformOptional } from './platform-context';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const DESKTOP_PLATFORM_ID = 'electron';

export function PwaUpdatePromptGate(): JSX.Element | null {
  const platform = usePlatformOptional();
  if (platform?.id === DESKTOP_PLATFORM_ID) return null;
  return <PwaUpdatePrompt />;
}
