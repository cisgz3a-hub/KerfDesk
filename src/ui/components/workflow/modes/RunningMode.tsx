/**
 * T1-208 (Phase 4): Running mode — embeds the existing `Progress`
 * component from the legacy panel so the progress bar / elapsed
 * time / ETA rendering stays consistent with the rest of the app.
 *
 * Pause and Stop buttons live in the PrimaryActionFooter (the
 * panel-wide design). This mode body is read-only progress info.
 */
import React from 'react';
import { Progress, type JobProgressData } from '../../connection/Progress';

export interface RunningModeProps {
  readonly jobProgress: JobProgressData | null;
  readonly elapsedSeconds: number;
  readonly estimatedRemaining: number | null;
  readonly activeLabel: string;
  readonly planSummary: string | null;
}

export function RunningMode({
  jobProgress,
  elapsedSeconds,
  estimatedRemaining,
  activeLabel,
  planSummary,
}: RunningModeProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-running-mode',
      style: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
      },
    },
    React.createElement(Progress, {
      jobProgress,
      displayPaused: false,
      elapsedSeconds,
      estimatedRemaining,
      activeLabel,
      planSummary,
    }),
  );
}
