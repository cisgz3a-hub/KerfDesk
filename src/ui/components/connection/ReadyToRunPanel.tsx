/**
 * T2-58: unified pre-flight surface for the final operator review.
 *
 * This component is intentionally presentational: ConnectionPanelMain owns
 * machine/job state, while this panel makes the "what will happen if I press
 * Start?" answer visible in one place.
 */
import React, { useState } from 'react';
import {
  orderRequiresAcknowledgement,
  summaryLine,
  type OrderAnalysis,
} from '../../../app/OperationOrder';
import { JobLayoutMiniMap, type JobLayoutMiniMapData } from './JobLayoutMiniMap';

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

export interface ReadyToRunMachineSummary {
  connectionLabel: string;
  profileLabel: string;
  statusLabel: string;
  bedLabel: string;
  positionLabel: string;
}

export interface ReadyToRunJobSummary {
  summaryLabel: string;
  boundsLabel: string;
  estimatedTimeLabel: string | null;
  operationAnalysis: OrderAnalysis;
}

export interface ReadyToRunMaterialReminder {
  id: string;
  label: string;
  detail?: string;
}

export interface ReadyToRunMaterialSummary {
  label: string;
  sizeLabel: string;
  reminders: readonly ReadyToRunMaterialReminder[];
}

export interface ReadyToRunPositionSummary {
  startModeLabel: string;
  originLabel: string;
  frameStatusLabel: string;
  layout?: JobLayoutMiniMapData | null;
}

export interface ReadyToRunWarning {
  id: string;
  severity: 'blocker' | 'warning';
  text: string;
  action?: string;
}

export interface ReadyToRunPanelData {
  machine: ReadyToRunMachineSummary;
  job: ReadyToRunJobSummary;
  material: ReadyToRunMaterialSummary;
  position: ReadyToRunPositionSummary;
  warnings: readonly ReadyToRunWarning[];
  canStartJob: boolean;
  startBlockedReason?: string | null;
}

interface Props {
  data: ReadyToRunPanelData;
  startLabel?: string;
  onStartJob: () => void;
}

function section(
  title: string,
  children: React.ReactNode,
  testId: string,
): React.ReactElement {
  return React.createElement('section', {
    'data-testid': testId,
    style: {
      padding: '10px 12px',
      borderRadius: 6,
      border: '1px solid #20203a',
      background: '#080812',
      minWidth: 0,
    },
  },
    React.createElement('div', {
      style: {
        marginBottom: 8,
        color: '#777798',
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: 0,
      },
    }, title),
    children,
  );
}

function row(label: string, value: string | null): React.ReactElement {
  return React.createElement('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 5,
      minWidth: 0,
    },
  },
    React.createElement('span', {
      style: { color: '#777798', fontSize: 10, flexShrink: 0 },
    }, label),
    React.createElement('span', {
      style: {
        color: '#d8d8e8',
        fontSize: 10,
        fontFamily: value != null && /\d/.test(value) ? mono : font,
        textAlign: 'right' as const,
        minWidth: 0,
        overflowWrap: 'anywhere' as const,
      },
    }, value ?? 'Not set'),
  );
}

function warningColor(severity: ReadyToRunWarning['severity']): string {
  return severity === 'blocker' ? '#ff8ca0' : '#ffd444';
}

function displayOperationRow(rowData: OrderAnalysis['rows'][number]): string {
  const kindLabel =
    rowData.kind === 'engrave' ? 'Engrave'
    : rowData.kind === 'image' ? 'Image'
    : rowData.kind === 'score' ? 'Score'
    : rowData.kind === 'cut' ? 'Cut'
    : 'Travel';
  const passes = rowData.passes > 1 ? ` - ${rowData.passes} passes` : '';
  return (
    `${rowData.index}. ${kindLabel} - ${rowData.layerName} - ` +
    `${rowData.powerPercent}% power - ${rowData.feedRateMmPerMin} mm/min${passes}`
  );
}

export function ReadyToRunPanel({
  data,
}: Props): React.ReactElement {
  const [checkedReminders, setCheckedReminders] = useState<Record<string, boolean>>({});
  const orderNeedsAck = orderRequiresAcknowledgement(data.job.operationAnalysis);
  const startDisabledReason = data.canStartJob
    ? null
    : data.startBlockedReason ?? 'Start is blocked by the current readiness gates';

  return React.createElement('div', {
    'data-testid': 'ready-to-run-panel',
    style: {
      margin: '0 16px 10px',
      padding: 12,
      borderRadius: 8,
      border: '1px solid rgba(45,212,160,0.28)',
      background: 'rgba(9,13,24,0.98)',
      fontFamily: font,
      flexShrink: 0,
    },
  },
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 10,
      },
    },
      React.createElement('div', { style: { minWidth: 0 } },
        React.createElement('div', {
          style: { color: '#2dd4a0', fontSize: 13, fontWeight: 800 },
        }, 'Job Review'),
        React.createElement('div', {
          style: { color: '#777798', fontSize: 10, marginTop: 2 },
        }, data.canStartJob ? 'Review the job, then use the main Start button below' : startDisabledReason),
      ),
      React.createElement('div', {
        style: {
          flexShrink: 0,
          padding: '6px 9px',
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 700,
          color: data.canStartJob ? '#2dd4a0' : '#555570',
          border: data.canStartJob ? '1px solid rgba(45,212,160,0.35)' : '1px solid rgba(255,212,68,0.28)',
          background: data.canStartJob ? 'rgba(45,212,160,0.08)' : 'rgba(255,212,68,0.06)',
        },
      }, data.canStartJob ? 'Ready' : 'Needs attention'),
    ),
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 8,
      },
    },
      section('Machine', React.createElement(React.Fragment, null,
        row('Connection', data.machine.connectionLabel),
        row('Profile', data.machine.profileLabel),
        row('Status', data.machine.statusLabel),
        row('Bed', data.machine.bedLabel),
        row('Head', data.machine.positionLabel),
      ), 'ready-to-run-section-machine'),
      section('Job', React.createElement(React.Fragment, null,
        row('Summary', data.job.summaryLabel),
        row('Bounds', data.job.boundsLabel),
        row('Estimated', data.job.estimatedTimeLabel),
      ), 'ready-to-run-section-job'),
      section('Material', React.createElement(React.Fragment, null,
        row('Material', data.material.label),
        row('Size', data.material.sizeLabel),
        data.material.reminders.length > 0 && React.createElement('div', {
          style: { marginTop: 8, display: 'flex', flexDirection: 'column' as const, gap: 5 },
        },
          data.material.reminders.map(reminder => React.createElement('label', {
            key: reminder.id,
            style: {
              display: 'flex',
              gap: 7,
              alignItems: 'flex-start',
              color: '#c8c8d8',
              fontSize: 10,
              lineHeight: 1.3,
            },
          },
            React.createElement('input', {
              type: 'checkbox',
              'data-testid': `ready-to-run-reminder-${reminder.id}`,
              checked: checkedReminders[reminder.id] === true,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const checked = e.currentTarget.checked;
                setCheckedReminders(prev => ({ ...prev, [reminder.id]: checked }));
              },
              style: { width: 12, height: 12, marginTop: 1, accentColor: '#2dd4a0', flexShrink: 0 },
            }),
            React.createElement('span', null,
              reminder.label,
              reminder.detail && React.createElement('span', {
                style: { display: 'block', color: '#777798', marginTop: 1 },
              }, reminder.detail),
            ),
          )),
        ),
      ), 'ready-to-run-section-material'),
      section('Position', React.createElement(React.Fragment, null,
        row('Start mode', data.position.startModeLabel),
        row('Origin', data.position.originLabel),
        row('Frame', data.position.frameStatusLabel),
        data.position.layout && React.createElement(JobLayoutMiniMap, { data: data.position.layout }),
      ), 'ready-to-run-section-position'),
    ),
    section('Operation order', React.createElement('div', null,
      React.createElement('div', {
        style: {
          color: orderNeedsAck ? '#ffd444' : '#2dd4a0',
          fontSize: 10,
          marginBottom: 6,
        },
      }, summaryLine(data.job.operationAnalysis)),
      data.job.operationAnalysis.rows.map((op, index) => React.createElement('div', {
        key: `${op.index}:${op.layerName}:${index}`,
        'data-testid': `ready-to-run-operation-${index}`,
        style: {
          padding: '4px 0',
          borderTop: index === 0 ? 'none' : '1px solid #151526',
          color: '#d8d8e8',
          fontSize: 10,
          fontFamily: mono,
          overflowWrap: 'anywhere' as const,
        },
      }, displayOperationRow(op))),
      data.job.operationAnalysis.warnings.map((warning, index) => React.createElement('div', {
        key: `${warning.kind}:${index}`,
        style: {
          marginTop: 6,
          color: '#ffd444',
          fontSize: 10,
          lineHeight: 1.35,
        },
      }, warning.message)),
    ), 'ready-to-run-section-operation-order'),
    section('Warnings', React.createElement('div', null,
      startDisabledReason && React.createElement('div', {
        style: { color: '#ff8ca0', fontSize: 10, lineHeight: 1.35, marginBottom: 6 },
      }, startDisabledReason),
      data.warnings.length === 0 && !startDisabledReason
        ? React.createElement('div', { style: { color: '#777798', fontSize: 10 } }, 'No blocking issues.')
        : data.warnings.map(warning => React.createElement('div', {
            key: warning.id,
            style: {
              color: warningColor(warning.severity),
              fontSize: 10,
              lineHeight: 1.35,
              marginTop: 4,
            },
          },
            warning.text,
            warning.action && React.createElement('span', {
              style: { display: 'block', color: '#90c8ff', marginTop: 1 },
            }, warning.action),
          )),
    ), 'ready-to-run-section-warnings'),
  );
}
