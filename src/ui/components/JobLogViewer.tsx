import React, { useState } from 'react';
import { getJobLogs, clearJobLogs } from '../../core/job/JobLog';

interface JobLogViewerProps {
  onLoadLog: (entries: string[]) => void;
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>;
}

export function JobLogViewer({ onLoadLog, showConfirm }: JobLogViewerProps) {
  const [showHistory, setShowHistory] = useState(false);
  const logs = getJobLogs();
  const font = "'DM Sans', system-ui, sans-serif";

  return React.createElement('div', null,
    React.createElement('div', { style: { padding: '4px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      React.createElement('button', {
        onClick: () => setShowHistory(!showHistory),
        style: { fontSize: 10, padding: '4px 10px', background: 'rgba(136,136,170,0.08)', border: '1px solid #252540', borderRadius: 4, color: '#8888aa', cursor: 'pointer', fontFamily: font },
      }, showHistory ? 'Hide History' : `Job History (${logs.length})`),
      logs.length > 0 && React.createElement('button', {
        onClick: async () => {
          const ok = await showConfirm('Clear logs', 'Clear all job logs?');
          if (!ok) return;
          clearJobLogs();
          setShowHistory(false);
        },
        style: { background: 'none', border: 'none', color: '#333355', fontSize: 9, cursor: 'pointer', fontFamily: font },
      }, 'Clear'),
    ),

    showHistory && React.createElement('div', {
      style: { padding: '0 18px 12px', maxHeight: 200, overflowY: 'auto' as const },
    },
      ...logs.map(log =>
        React.createElement('div', {
          key: log.id,
          style: {
            padding: '8px 10px', marginBottom: 4,
            background: '#0a0a14', borderRadius: 6,
            border: `1px solid ${log.status === 'completed' ? '#1a2e1a' : log.status === 'failed' ? '#2e1a1a' : '#1a1a2e'}`,
            fontSize: 10, cursor: 'pointer',
          },
          onClick: () => {
            onLoadLog([
              `═══ JOB REPLAY: ${log.projectName} ═══`,
              `Status: ${log.status.toUpperCase()}`,
              `Started: ${new Date(log.startedAt).toLocaleString()}`,
              `Duration: ${(log.actualDuration / 1000).toFixed(0)}s`,
              `Lines: ${log.linesCompleted}/${log.gcodeLines}`,
              `Errors: ${log.errors}`,
              '',
              ...log.entries.slice(-100).map(e => {
                const time = new Date(e.timestamp).toLocaleTimeString();
                const prefix = e.type === 'error' ? '✗' : e.type === 'milestone' ? '★' : e.type === 'sent' ? '>' : '<';
                return `[${time}] ${prefix} ${e.message}`;
              }),
            ]);
          },
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 2 } },
            React.createElement('span', { style: { color: '#e0e0ec', fontWeight: 500 } }, log.projectName),
            React.createElement('span', {
              style: { color: log.status === 'completed' ? '#2dd4a0' : log.status === 'failed' ? '#ff4466' : '#ffd444', fontWeight: 600 },
            }, log.status.toUpperCase()),
          ),
          React.createElement('div', { style: { color: '#555570', display: 'flex', gap: 8 } },
            React.createElement('span', null, new Date(log.startedAt).toLocaleDateString()),
            React.createElement('span', null, `${(log.actualDuration / 1000).toFixed(0)}s`),
            React.createElement('span', null, `${log.linesCompleted}/${log.gcodeLines} lines`),
            log.errors > 0 && React.createElement('span', { style: { color: '#ff4466' } }, `${log.errors} errors`),
          ),
        ),
      ),
    ),
  );
}
