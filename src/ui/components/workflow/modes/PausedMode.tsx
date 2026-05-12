/**
 * T1-208 (Phase 4): Paused mode — same shape as RunningMode but
 * with `displayPaused: true` so the existing `Progress` component
 * surfaces the paused indicator.
 *
 * Resume and Stop buttons live in the PrimaryActionFooter. This
 * mode body is read-only progress info.
 */
import React from 'react';
import { Progress, type JobProgressData } from '../../connection/Progress';

export interface PausedModeProps {
  readonly jobProgress: JobProgressData | null;
  readonly elapsedSeconds: number;
  readonly estimatedRemaining: number | null;
  readonly planSummary: string | null;
}

export function PausedMode({
  jobProgress,
  elapsedSeconds,
  estimatedRemaining,
  planSummary,
}: PausedModeProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-paused-mode',
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
      displayPaused: true,
      elapsedSeconds,
      estimatedRemaining,
      planSummary,
    }),
  );
}
