import { useEffect } from 'react';
import { usePlatformOptional } from '../app/platform-context';
import { useToastStore } from '../state/toast-store';
import { watchRendererProblems } from './renderer-problems';
import { saveSupportReport } from './save-support-report';
import { SUPPORT_REPORT_EVENT } from './support-report-event';

/**
 * Keeps this window's recent problems and answers Help > Save Support Report
 * (ADR-546). The save starts inside the menu click, so the browser's file
 * picker still sees the user's gesture.
 */
export function SupportReportHost(): null {
  const platform = usePlatformOptional();
  useEffect(() => watchRendererProblems(), []);
  useEffect(() => {
    const save = (): void => {
      if (platform === null) {
        useToastStore.getState().pushToast('A support report cannot be saved here.', 'error');
        return;
      }
      void saveSupportReport(platform);
    };
    window.addEventListener(SUPPORT_REPORT_EVENT, save);
    return () => window.removeEventListener(SUPPORT_REPORT_EVENT, save);
  }, [platform]);
  return null;
}
