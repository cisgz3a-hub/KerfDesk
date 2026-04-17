import React from 'react';
import { type GcodeStartMode } from '../../../core/output/GcodeOrigin';

interface WorkflowProps {
  startMode: GcodeStartMode;
  onSelectMode: (mode: GcodeStartMode) => void;
  startPositionStatus: string;
  machinePositionKnown: boolean;
  hasJogged: boolean;
  hasSetOrigin: boolean;
  hasFramed: boolean;
  canStartJob: boolean;
  startJobDesc: string;
  estimatedTimeFormatted: string | null;
  isConnected: boolean;
  onSaveOrigin: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

interface WorkflowStep {
  num: number;
  label: string;
  description: string;
  done: boolean;
  action?: () => void;
  actionLabel?: string;
  primary: boolean;
}

function buildSteps(props: WorkflowProps): WorkflowStep[] {
  const { startMode, hasJogged, hasSetOrigin, hasFramed, canStartJob, startJobDesc, onSaveOrigin, isConnected } = props;

  const jog: WorkflowStep = {
    num: 0,
    label: 'Jog to workpiece',
    description: 'Move the laser head to where you want to start',
    done: hasJogged,
    primary: false,
  };

  const setOrigin: WorkflowStep = {
    num: 0,
    label: 'Set origin here',
    description: 'Store the current head position as the saved reference',
    done: hasSetOrigin,
    action: isConnected ? onSaveOrigin : undefined,
    actionLabel: '📌 Set Origin',
    primary: false,
  };

  const frame: WorkflowStep = {
    num: 0,
    label: 'Frame the job',
    description: 'Preview where the laser will cut — use Frame below',
    done: hasFramed,
    primary: false,
  };

  const start: WorkflowStep = {
    num: 0,
    label: 'Start job',
    description: startJobDesc,
    done: false,
    primary: true,
  };

  void canStartJob;

  let steps: WorkflowStep[];
  if (startMode === 'absolute') {
    steps = [frame, start];
  } else if (startMode === 'current') {
    steps = [jog, frame, start];
  } else {
    steps = [jog, setOrigin, frame, start];
  }

  return steps.map((s, i) => ({ ...s, num: i + 1 }));
}

export function Workflow(props: WorkflowProps) {
  const {
    startMode,
    onSelectMode,
    startPositionStatus,
    machinePositionKnown,
    canStartJob,
    estimatedTimeFormatted,
  } = props;

  const steps = buildSteps(props);

  const modes: Array<{ mode: GcodeStartMode; label: string }> = [
    { mode: 'absolute', label: '📍 Bed' },
    { mode: 'current', label: '🎯 Head' },
    { mode: 'savedOrigin', label: '⚑ Origin' },
  ];

  return React.createElement('div', {
    style: { padding: '12px 16px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
  },
    React.createElement('div', {
      style: { fontSize: 9, color: '#555570', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 1 },
    }, 'Start Position'),
    React.createElement('div', { style: { display: 'flex', gap: 3, marginBottom: 6 } },
      ...modes.map(m =>
        React.createElement('button', {
          type: 'button',
          key: m.mode,
          onClick: () => onSelectMode(m.mode),
          disabled: m.mode === 'current' && !machinePositionKnown,
          style: {
            flex: 1, padding: '5px', fontSize: 10, borderRadius: 4, cursor: 'pointer', fontFamily: font,
            background: startMode === m.mode ? 'rgba(0,212,255,0.1)' : 'transparent',
            border: startMode === m.mode ? '1px solid #00d4ff' : '1px solid #252540',
            color: startMode === m.mode ? '#00d4ff' : '#555570',
            opacity: m.mode === 'current' && !machinePositionKnown ? 0.4 : 1,
          },
        }, m.label),
      ),
    ),
    React.createElement('div', {
      style: { fontSize: 9, color: '#555570', lineHeight: 1.25, marginBottom: 10 },
    }, startPositionStatus),
    React.createElement('div', {
      style: { fontSize: 10, color: '#555570', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 1 },
    }, 'Workflow'),
    ...steps.map((step, idx) =>
    React.createElement('div', {
      key: step.num,
      style: {
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 0',
        borderBottom: idx < steps.length - 1 ? '1px solid #12121e' : 'none',
        opacity: step.primary && !canStartJob ? 0.55 : 1,
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
      style: {
        padding: '6px 12px', fontSize: 10, fontWeight: 600, borderRadius: 6,
        cursor: 'pointer', fontFamily: font, flexShrink: 0, whiteSpace: 'nowrap' as const,
        background: '#0a0a14', border: '1px solid #252540', color: '#c0c0d0',
      },
    }, step.actionLabel ?? ''),
    ),
    ),
    estimatedTimeFormatted != null && React.createElement('div', {
      style: {
        marginTop: 6, fontSize: 10, fontFamily: mono,
        color: '#00d4ff', textAlign: 'right' as const,
      },
    }, `Est. ${estimatedTimeFormatted}`),
  );
}
