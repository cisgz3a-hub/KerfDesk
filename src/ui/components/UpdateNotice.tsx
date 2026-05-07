import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { theme } from '../styles/theme';

export type UpdateEventKind =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'download-progress'
  | 'downloaded'
  | 'error';

interface UpdateNoticeProps {
  isJobRunning: boolean;
}

interface UpdateNoticeState {
  kind: UpdateEventKind;
  message: string;
  percent: number | null;
}

function readPercent(payload: unknown): number | null {
  if (payload == null || typeof payload !== 'object') return null;
  const value = (payload as { percent?: unknown }).percent;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function readErrorMessage(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload instanceof Error && payload.message.trim()) return payload.message;
  return 'Update check failed.';
}

function normalizeUpdateEvent(event: unknown): UpdateNoticeState | null {
  if (event == null || typeof event !== 'object') return null;
  const { kind, payload } = event as { kind?: unknown; payload?: unknown };

  switch (kind) {
    case 'checking':
      return { kind: 'checking', message: 'Checking for updates...', percent: null };
    case 'available':
      return { kind: 'available', message: 'Update found. Downloading...', percent: null };
    case 'not-available':
      return { kind: 'not-available', message: 'LaserForge is up to date.', percent: null };
    case 'download-progress': {
      const percent = readPercent(payload);
      const label = percent == null ? 'Downloading update...' : `Downloading update ${Math.round(percent)}%`;
      return { kind: 'download-progress', message: label, percent };
    }
    case 'downloaded':
      return { kind: 'downloaded', message: 'Update ready. Restart to update.', percent: 100 };
    case 'error':
      return { kind: 'error', message: readErrorMessage(payload), percent: null };
    default:
      return null;
  }
}

function resultFailed(result: unknown): string | null {
  if (result == null || typeof result !== 'object') return null;
  const maybe = result as { ok?: unknown; reason?: unknown };
  if (maybe.ok !== false) return null;
  return typeof maybe.reason === 'string' && maybe.reason.trim()
    ? maybe.reason
    : 'Update operation failed.';
}

// T3-5: renderer-visible update channel for the T2-101 Electron updater IPC foundation.
export function UpdateNotice({ isJobRunning }: UpdateNoticeProps): React.ReactElement | null {
  const updates = window.electronAPI?.updates;
  const [state, setState] = useState<UpdateNoticeState>({
    kind: 'idle',
    message: '',
    percent: null,
  });

  useEffect(() => {
    if (!updates) return undefined;
    const unsubscribe = updates.onEvent((event: unknown) => {
      const next = normalizeUpdateEvent(event);
      if (next) setState(next);
    });
    return unsubscribe;
  }, [updates]);

  const checkNow = useCallback(() => {
    if (!updates) return;
    setState({ kind: 'checking', message: 'Checking for updates...', percent: null });
    void updates.check().then((result: unknown) => {
      const reason = resultFailed(result);
      if (reason) {
        setState({ kind: 'error', message: reason, percent: null });
      }
    }, (err: unknown) => {
      setState({ kind: 'error', message: readErrorMessage(err), percent: null });
    });
  }, [updates]);

  const installUpdate = useCallback(() => {
    if (!updates) return;
    void updates.install({ jobRunning: isJobRunning }).then((result: unknown) => {
      const reason = resultFailed(result);
      if (reason) {
        setState({ kind: 'error', message: reason, percent: null });
      }
    }, (err: unknown) => {
      setState({ kind: 'error', message: readErrorMessage(err), percent: null });
    });
  }, [isJobRunning, updates]);

  const visible = updates != null && state.kind !== 'idle' && state.kind !== 'not-available';
  const tone = state.kind === 'error' ? '#ff4466'
    : state.kind === 'downloaded' ? '#2dd4a0'
      : '#00d4ff';

  const action = useMemo(() => {
    if (state.kind === 'downloaded') {
      return React.createElement('button', {
        type: 'button',
        onClick: installUpdate,
        disabled: isJobRunning,
        title: isJobRunning ? 'Job running - finish or stop the job before restarting.' : 'Restart LaserForge to install the downloaded update.',
        style: {
          border: `1px solid ${isJobRunning ? '#333348' : '#2dd4a0'}`,
          background: isJobRunning ? '#151525' : '#11251f',
          color: isJobRunning ? '#777790' : '#9df5d0',
          borderRadius: 4,
          padding: '4px 10px',
          cursor: isJobRunning ? 'not-allowed' : 'pointer',
          fontSize: 11,
          fontFamily: theme.font.ui,
          whiteSpace: 'nowrap' as const,
        },
      }, isJobRunning ? 'Job running' : 'Restart to update');
    }

    return React.createElement('button', {
      type: 'button',
      onClick: checkNow,
      style: {
        border: '1px solid #244466',
        background: '#101a2a',
        color: '#9dccff',
        borderRadius: 4,
        padding: '4px 10px',
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: theme.font.ui,
        whiteSpace: 'nowrap' as const,
      },
    }, 'Check updates');
  }, [checkNow, installUpdate, isJobRunning, state.kind]);

  if (!visible) return null;

  return React.createElement('div', {
    'data-testid': state.kind === 'error' ? 'update-error' : 'update-notice',
    style: {
      minHeight: 34,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '6px 12px',
      background: '#090913',
      borderTop: '1px solid #17172a',
      borderBottom: '1px solid #17172a',
      color: theme.text.primary,
      fontFamily: theme.font.ui,
      flexShrink: 0,
    },
  },
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
    },
      React.createElement('span', {
        style: { width: 7, height: 7, borderRadius: '50%', background: tone, flexShrink: 0 },
      }),
      React.createElement('span', {
        style: {
          fontSize: 12,
          color: state.kind === 'error' ? '#ff8ba0' : '#d8e0ff',
          whiteSpace: 'nowrap' as const,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        },
      }, state.message),
      state.percent != null && state.kind === 'download-progress' && React.createElement('span', {
        style: { fontSize: 11, color: '#777790', fontFamily: theme.font.mono },
      }, `${Math.round(state.percent)}%`),
    ),
    action,
  );
}
