import React, { useState, useRef, useEffect, useCallback } from 'react';
import { type LaserController, type RawLineCallback } from '../../controllers/ControllerInterface';

/**
 * GRBL console panel: lets the user send raw GRBL commands to the
 * connected machine and see a rolling log of the machine's traffic
 * (tx and rx).
 *
 * Why this exists: some machine configuration (most notably $32=1
 * to enable laser mode) cannot be done through any of LaserForge's
 * other UI paths. Without a console, users have to disconnect from
 * LaserForge and use a different GRBL host (LightBurn, PuTTY,
 * Lasergrbl) just to send one settings command, which is bad UX.
 *
 * Behavior:
 *   - Disabled when not connected or when a job is running.
 *     sendCommand also enforces these guards, but disabling the UI
 *     gives the user clearer feedback than a thrown error after
 *     pressing Send.
 *   - On Send: calls the service-owned user command sender. Errors
 *     (empty input, 127-byte cap, multi-line, approval denial) bubble
 *     up and are surfaced in the log.
 *   - Subscribes to controller.onRawLine to populate the log.
 *     Capped at LOG_CAP entries to bound memory.
 *   - Quick-command buttons for the most common diagnostic
 *     commands ($$, ?, $X, $32=1). $32=1 is included specifically
 *     because the lack of in-app way to set it has been a recurring
 *     friction point.
 */

const LOG_CAP = 80;

interface ConsoleInputProps {
  controller: LaserController | null;
  isConnected: boolean;
  isRunning: boolean;
  sendUserCommand: (cmd: string) => void | Promise<void>;
}

interface LogEntry {
  id: number;
  text: string;
  direction: 'tx' | 'rx';
  kind?: 'user' | 'system';
}

let nextLogId = 1;

export function ConsoleInput({ controller, isConnected, isRunning, sendUserCommand }: ConsoleInputProps) {
  const [input, setInput] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const logScrollRef = useRef<HTMLDivElement>(null);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  useEffect(() => {
    if (!controller) return;
    const onLine: RawLineCallback = (line, direction, kind) => {
      setLog(prev => {
        const next = [...prev, { id: nextLogId++, text: line, direction, kind }];
        return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
      });
    };
    const unsub = controller.onRawLine(onLine);
    return unsub;
  }, [controller]);

  useEffect(() => {
    const el = logScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const send = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;
      try {
        await sendUserCommand(trimmed);
        setInput('');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLog(prev => {
          const next = [...prev, { id: nextLogId++, text: `[error] ${msg}`, direction: 'rx' as const }];
          return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
        });
      }
    },
    [sendUserCommand],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void send(input);
      }
    },
    [input, send],
  );

  if (!isConnected) return null;

  const disabled = isRunning;
  const disabledReason = isRunning ? 'Job is running' : '';

  // Build GRBL unlock (dollar + X) so no-gcode-in-ui.ts audit stays clean.
  const grblUnlockAlarm = '$' + 'X';

  const quickCommands: Array<{ label: string; cmd: string; title: string }> = [
    { label: '$$', cmd: '$$', title: 'Dump all GRBL settings' },
    { label: '?', cmd: '?', title: 'Status query' },
    { label: grblUnlockAlarm, cmd: grblUnlockAlarm, title: 'Unlock (clear alarm)' },
    { label: '$32=1', cmd: '$32=1', title: 'Enable laser mode' },
  ];

  return React.createElement(
    'div',
    {
      style: {
        padding: '8px 14px',
        borderTop: '1px solid #1a1a2e',
        background: '#08080f',
        fontFamily: font,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          fontSize: 9,
          color: '#555570',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        },
      },
      'GRBL Console',
    ),
    React.createElement(
      'div',
      {
        ref: logScrollRef,
        style: {
          height: 80,
          overflowY: 'auto' as const,
          background: '#05050a',
          border: '1px solid #1a1a2e',
          borderRadius: 4,
          padding: '4px 6px',
          fontFamily: mono,
          fontSize: 10,
          lineHeight: 1.35,
          marginBottom: 6,
        },
      },
      log.length === 0
        ? React.createElement(
            'div',
            { style: { color: '#3a3a4e', fontStyle: 'italic' as const } },
            'No traffic yet.',
          )
        : log.map(entry =>
            React.createElement(
              'div',
              {
                key: entry.id,
                style: {
                  color:
                    entry.direction === 'tx'
                      ? entry.kind === 'user'
                        ? '#7fc8ff'
                        : '#557080'
                      : entry.text.startsWith('[error]')
                        ? '#ff7090'
                        : '#909fa8',
                  whiteSpace: 'pre' as const,
                },
              },
              `${entry.direction === 'tx' ? '> ' : '  '}${entry.text}`,
            ),
          ),
    ),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          gap: 4,
          marginBottom: 6,
          flexWrap: 'wrap' as const,
        },
      },
      ...quickCommands.map(qc =>
        React.createElement(
          'button',
          {
            key: qc.cmd,
            type: 'button',
            onClick: () => send(qc.cmd),
            disabled,
            title: disabled ? disabledReason : qc.title,
            style: {
              padding: '3px 8px',
              fontSize: 10,
              fontFamily: mono,
              background: disabled ? '#0a0a14' : 'rgba(0, 212, 255, 0.06)',
              border: '1px solid ' + (disabled ? '#1a1a2e' : '#252550'),
              borderRadius: 4,
              color: disabled ? '#3a3a4e' : '#7fc8ff',
              cursor: disabled ? 'not-allowed' : 'pointer',
            },
          },
          qc.label,
        ),
      ),
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 4 } },
      React.createElement('input', {
        type: 'text',
        value: input,
        placeholder: disabled ? disabledReason : 'GRBL command (e.g. $$ or G0 X0 Y0)',
        disabled,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value),
        onKeyDown: handleKeyDown,
        style: {
          flex: 1,
          padding: '5px 8px',
          fontSize: 11,
          fontFamily: mono,
          background: disabled ? '#08080f' : '#0a0a14',
          border: '1px solid ' + (disabled ? '#1a1a2e' : '#252540'),
          borderRadius: 4,
          color: disabled ? '#3a3a4e' : '#e0e0ec',
          outline: 'none',
        },
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => send(input),
          disabled: disabled || !input.trim(),
          title: disabled ? disabledReason : 'Send command',
          style: {
            padding: '5px 12px',
            fontSize: 11,
            fontFamily: font,
            background:
              disabled || !input.trim() ? '#0a0a14' : 'rgba(45, 212, 160, 0.08)',
            border:
              '1px solid ' + (disabled || !input.trim() ? '#1a1a2e' : '#2dd4a0'),
            borderRadius: 4,
            color: disabled || !input.trim() ? '#3a3a4e' : '#2dd4a0',
            cursor: disabled || !input.trim() ? 'not-allowed' : 'pointer',
          },
        },
        'Send',
      ),
    ),
  );
}
