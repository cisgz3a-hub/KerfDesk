import { useSyncExternalStore } from 'react';
import { appThemePreference, subscribeAppTheme, type AppThemePreference } from './app-theme';

// Server/prerender snapshot matches app-theme.ts's own default so the first
// client render cannot disagree with the markup it hydrates.
export function useAppThemePreference(): AppThemePreference {
  return useSyncExternalStore(subscribeAppTheme, appThemePreference, () => 'light');
}
