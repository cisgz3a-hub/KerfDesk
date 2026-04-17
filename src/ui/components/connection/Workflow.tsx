import React from 'react';

interface WorkflowProps {
  hasZeroed: boolean;
  hasFramed: boolean;
  canStartJob: boolean;
  canFrame: boolean;
  startJobDesc: string;
  onZero: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

export function Workflow({ hasZeroed, hasFramed, canStartJob, canFrame, startJobDesc, onZero }: WorkflowProps) {
  const step1Done = hasZeroed;
  const step3Done = hasFramed;

  return React.createElement('div', {
    style: { padding: '12px 16px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
  },
  React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 1 } }, 'Workflow'),
  ...([
    {
      num: 1,
      label: 'Jog to workpiece',
      description: 'Move the laser head to where you want to start',
      done: step1Done,
      action: undefined as (() => void) | undefined,
      actionLabel: '',
      primary: false,
      disabled: false,
    },
    {
      num: 2,
      label: 'Zero position',
      description: 'Set this as the starting point',
      done: step1Done,
      action: () => { onZero(); },
      actionLabel: '◎ Zero Here',
      primary: false,
      disabled: false,
    },
    {
      num: 3,
      label: 'Frame the job',
      description: 'Preview where the laser will cut — use Frame below',
      done: step3Done,
      action: undefined as (() => void) | undefined,
      actionLabel: '',
      primary: false,
      disabled: false,
    },
    {
      num: 4,
      label: 'Start job',
      description: startJobDesc,
      done: false,
      action: undefined as (() => void) | undefined,
      actionLabel: '',
      primary: true,
      disabled: false,
    },
  ] as const).map(step =>
    React.createElement('div', {
      key: step.num,
      style: {
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 0',
        borderBottom: step.num < 4 ? '1px solid #12121e' : 'none',
        opacity: step.num === 4 && !canStartJob ? 0.55 : 1,
      },
    },
    React.createElement('div', {
      style: {
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, fontFamily: mono,
        background: step.done ? 'rgba(45,212,160,0.15)' : '#0a0a14',
        border: step.done ? '1px solid #2dd4a0' : '1px solid #252540',
        color: step.done ? '#2dd4a0' : '#555570',
      },
    }, step.done ? '✓' : String(step.num)),
    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
      React.createElement('div', { style: { fontSize: 12, color: step.done ? '#2dd4a0' : '#e0e0ec', fontWeight: 500 } }, step.label),
      React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 1 } }, step.description),
    ),
    step.action && React.createElement('button', {
      type: 'button',
      onClick: step.action,
      disabled: step.disabled,
      style: {
        padding: step.primary ? '8px 20px' : '6px 12px',
        fontSize: step.primary ? 12 : 10,
        fontWeight: 600, borderRadius: 6, cursor: step.disabled ? 'default' : 'pointer',
        fontFamily: font, flexShrink: 0, whiteSpace: 'nowrap' as const,
        background: step.primary
          ? (canStartJob ? 'rgba(45,212,160,0.12)' : '#1a1a2e')
          : '#0a0a14',
        border: step.primary
          ? (canStartJob ? '1px solid #2dd4a0' : '1px solid #252540')
          : '1px solid #252540',
        color: step.primary
          ? (canStartJob ? '#2dd4a0' : '#333355')
          : '#c0c0d0',
        opacity: step.disabled && step.num === 3 ? (canFrame ? 1 : 0.45) : 1,
      },
    }, step.actionLabel),
    ),
  ),
  );
}
