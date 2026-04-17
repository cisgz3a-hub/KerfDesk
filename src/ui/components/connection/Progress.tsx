import React from 'react';

export interface JobProgressData {
  percentComplete?: number;
  linesAcknowledged?: number;
  totalLines?: number;
}

interface ProgressProps {
  jobProgress: JobProgressData | null | undefined;
  displayPaused: boolean;
  elapsedSeconds: number;
  estimatedRemaining: number | null;
  /** Verb shown while running: "Cutting" / "Engraving" / "Scoring" / "Running". */
  activeLabel?: string;
}

const mono = "'JetBrains Mono', monospace";

function formatJobTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function Progress({
  jobProgress,
  displayPaused,
  elapsedSeconds,
  estimatedRemaining,
  activeLabel = 'Running',
}: ProgressProps) {
  return React.createElement('div', {
    style: { padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: 12, flexShrink: 0 },
  },
    React.createElement('div', { style: { textAlign: 'center' as const } },
      React.createElement('div', {
        style: { fontSize: 16, fontWeight: 700, color: displayPaused ? '#ffd444' : '#2dd4a0' },
      }, displayPaused ? '⏸ Paused' : `▶ ${activeLabel}...`),
    ),
    React.createElement('div', null,
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8888aa', marginBottom: 4 },
      },
        React.createElement('span', { style: { fontFamily: mono } },
          `${jobProgress?.percentComplete?.toFixed(0) ?? 0}%`,
        ),
        React.createElement('span', { style: { fontFamily: mono } },
          `${jobProgress?.linesAcknowledged ?? 0} / ${jobProgress?.totalLines ?? 0}`,
        ),
      ),
      React.createElement('div', {
        style: { width: '100%', height: 10, background: '#1a1a2e', borderRadius: 5, overflow: 'hidden' },
      },
        React.createElement('div', {
          style: {
            width: `${jobProgress?.percentComplete ?? 0}%`,
            height: '100%',
            background: displayPaused ? '#ffd444' : '#2dd4a0',
            borderRadius: 5,
            transition: 'width 0.3s',
          },
        }),
      ),
    ),
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: mono, color: '#555570' },
    },
      React.createElement('span', null, `Elapsed: ${formatJobTime(elapsedSeconds)}`),
      estimatedRemaining != null && estimatedRemaining > 0 &&
        React.createElement('span', null, `~${formatJobTime(estimatedRemaining)} left`),
    ),
  );
}
