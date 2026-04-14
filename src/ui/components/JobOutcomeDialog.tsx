import React from 'react';
import { type JobReplay } from '../../core/replay/JobReplay';

export interface JobOutcomeDialogProps {
  font: string;
  replay: JobReplay;
  onOutcome: (outcome: NonNullable<JobReplay['outcome']>) => void;
  onSkip: () => void;
}

export function JobOutcomeDialog({ font, replay, onOutcome, onSkip }: JobOutcomeDialogProps) {
  return React.createElement(
    'div',
    {
      key: replay.id,
      style: {
        margin: '0 16px 8px',
        padding: '10px',
        background: 'rgba(45,212,160,0.06)',
        borderRadius: 8,
        border: '1px solid rgba(45,212,160,0.2)',
      },
    },
    React.createElement(
      'div',
      {
        style: { fontSize: 11, fontWeight: 600, color: '#2dd4a0', marginBottom: 8 },
      },
      '\u2713 Job complete — how did it turn out?',
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 4, flexWrap: 'wrap' as const } },
      ...(['perfect', 'too_dark', 'too_light', 'didnt_cut', 'burned'] as const).map(outcome =>
        React.createElement(
          'button',
          {
            key: outcome,
            type: 'button',
            onClick: () => {
              onOutcome(outcome);
            },
            style: {
              padding: '5px 8px',
              fontSize: 10,
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid #252540',
              borderRadius: 6,
              color: '#8888aa',
              fontFamily: font,
            },
          },
          outcome === 'perfect'
            ? '\u2713 Perfect'
            : outcome === 'too_dark'
              ? 'Too dark'
              : outcome === 'too_light'
                ? 'Too light'
                : outcome === 'didnt_cut'
                  ? "Didn't cut"
                  : 'Burned',
        ),
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: onSkip,
          style: {
            padding: '5px 8px',
            fontSize: 10,
            cursor: 'pointer',
            background: 'transparent',
            border: '1px solid #1a1a2e',
            borderRadius: 6,
            color: '#555570',
            fontFamily: font,
          },
        },
        'Skip',
      ),
    ),
  );
}
