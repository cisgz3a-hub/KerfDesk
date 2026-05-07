import React from 'react';
import type { RecoveryCardContent } from './RecoveryCardContent';

const font = "'DM Sans', system-ui, sans-serif";

const actionLabel: Record<string, string> = {
  unlock: 'Unlock',
  home: 'Home',
  're-home': 'Re-home',
  reconnect: 'Reconnect',
  reframe: 'Re-frame',
  frame: 'Frame',
  stop: 'Stop',
  compile: 'Compile',
};

export interface RecoveryCardProps {
  content: RecoveryCardContent;
  onAction?: (action: string) => void;
}

/**
 * T2-62 follow-up: reusable React surface for the structured recovery
 * content layer. Action buttons are optional so the card can ship as a
 * readable recovery surface before every command is wired.
 */
export function RecoveryCard({ content, onAction }: RecoveryCardProps) {
  return React.createElement('section', {
    'data-recovery-card': content.variant,
    style: {
      margin: '10px 16px',
      padding: '12px 14px',
      background: 'rgba(255,68,102,0.08)',
      border: '1px solid rgba(255,68,102,0.42)',
      borderRadius: 8,
      color: '#f5d5dc',
      fontFamily: font,
      flexShrink: 0,
    },
  },
    React.createElement('div', {
      style: { fontSize: 12, fontWeight: 700, color: '#ff6b86', marginBottom: 8 },
    }, content.title),
    React.createElement('div', {
      style: { fontSize: 10, color: '#ff9caf', lineHeight: 1.45, marginBottom: 6 },
    }, content.whatHappened),
    React.createElement('div', {
      style: { fontSize: 10, color: '#c8bdd0', lineHeight: 1.45, marginBottom: 8 },
    }, content.whatItMeans),
    React.createElement('ol', {
      style: { margin: 0, paddingLeft: 18, display: 'grid', gap: 6 },
    },
      ...content.steps.map((step, index) =>
        React.createElement('li', {
          key: `${step.action ?? 'step'}-${index}`,
          style: { fontSize: 10, color: '#e6dbe8', lineHeight: 1.4 },
        },
          step.text,
          step.action && React.createElement('button', {
            type: 'button',
            disabled: onAction == null,
            onClick: () => onAction?.(step.action!),
            style: {
              marginLeft: 8,
              padding: '3px 8px',
              borderRadius: 5,
              border: '1px solid rgba(255,107,134,0.45)',
              background: onAction == null ? 'rgba(255,255,255,0.04)' : 'rgba(255,68,102,0.16)',
              color: onAction == null ? '#8d7580' : '#ffd6de',
              cursor: onAction == null ? 'default' : 'pointer',
              fontSize: 10,
              fontFamily: font,
            },
          }, actionLabel[step.action] ?? step.action),
        ),
      ),
    ),
    content.doNot && React.createElement('div', {
      style: {
        marginTop: 10,
        padding: '7px 8px',
        background: 'rgba(255,68,102,0.1)',
        borderRadius: 6,
        fontSize: 10,
        color: '#ffb8c4',
        lineHeight: 1.4,
      },
    }, `Do not: ${content.doNot}`),
  );
}
