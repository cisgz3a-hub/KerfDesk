/**
 * Falcon A1 Pro WiFi — read-only status panel (Phase 1).
 *
 * Responsibilities:
 *   - Subscribe to the main-process WS event stream for live state,
 *     door status, and alarms.
 *   - Poll /work/progress and /device/state every 2 seconds while the
 *     machine is RUNNING; stop when idle so we don't hammer the WiFi link.
 *   - Surface `type === 1` alarm events as toasts.
 *   - Offer a Reconnect button when the WebSocket disconnects.
 *
 * Deliberately NOT doing in Phase 1:
 *   - Job submission (upload + start) — Phase 2.
 *   - Jog / home / framing — Phase 2+.
 *   - Camera / RTSP — Phase 4.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  falconIpc,
  falconStateColor,
  falconStateName,
  type FalconDeviceModuleStatus,
  type FalconWsEvent,
} from './falconIpc';
import { pushFalconAlarmToast } from './FalconAlarmToast';

interface Props {
  ip: string;
  deviceModel?: string;
  firmwareVersion?: string;
  laserInfo?: {
    laserType: string;
    laserClass: string;
    zaxisVersion: string;
    laserSN: string;
  };
  macAddress?: string;
  /** Optional: called when the user clicks the "Disconnect" action. */
  onDisconnect?: () => void;
}

type ConnState = 'connecting' | 'open' | 'closed' | 'error';

interface AlarmEntry {
  id: string;
  at: number;
  type: number;
  code: string;
}

const POLL_INTERVAL_MS = 2_000;
const MAX_RECENT_ALARMS = 5;

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

function formatProgress(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** Known alarm codes -> human description. Extended over time as more are observed. */
const ALARM_LABELS: Record<string, string> = {
  '01000000': 'Heartbeat / ACK',
  '01002002': 'Safety door opened',
};

function alarmLabel(code: string): string {
  return ALARM_LABELS[code] ?? `Alarm ${code}`;
}

export function FalconWiFiStatusPanel(props: Props): React.ReactElement {
  const { ip, deviceModel, firmwareVersion, laserInfo, macAddress, onDisconnect } = props;

  const [connState, setConnState] = useState<ConnState>('connecting');
  const [connError, setConnError] = useState<string | null>(null);
  const [machineState, setMachineState] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [doorOpen, setDoorOpen] = useState<boolean | null>(null);
  const [alarms, setAlarms] = useState<AlarmEntry[]>([]);
  const [infoCollapsed, setInfoCollapsed] = useState(true);
  const [moduleList, setModuleList] = useState<FalconDeviceModuleStatus[]>([]);

  const ipRef = useRef(ip);
  ipRef.current = ip;
  const machineStateRef = useRef<number | null>(null);
  machineStateRef.current = machineState;

  // ── WebSocket subscription ──────────────────────────────
  const connectWs = useCallback(async () => {
    setConnState('connecting');
    setConnError(null);
    try {
      const res = await falconIpc.wsConnect(ipRef.current);
      if (!res.ok) {
        setConnState('error');
        setConnError(res.error ?? 'WebSocket connect failed');
      }
    } catch (err) {
      setConnState('error');
      setConnError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = falconIpc.onWsEvent((event: FalconWsEvent) => {
      if (cancelled) return;
      switch (event.kind) {
        case 'connection':
          setConnState(event.state);
          if (event.state === 'error') setConnError(event.error ?? 'unknown error');
          if (event.state === 'open') setConnError(null);
          break;
        case 'snapshot': {
          setModuleList(event.modules);
          for (const m of event.modules) {
            if (m.module === 'safeDoor' && typeof m.curState === 'number') {
              setDoorOpen(m.curState === 1);
            }
            if (m.module === 'printer' && typeof m.curState === 'number') {
              setMachineState(m.curState);
            }
          }
          break;
        }
        case 'printer':
          setMachineState(event.curState);
          break;
        case 'safeDoor':
          setDoorOpen(event.curState === 1);
          if (event.curState === 1) {
            pushFalconAlarmToast({
              title: 'Safety door opened',
              detail: 'Falcon motion is inhibited until the door is closed.',
              tone: 'warning',
            });
          }
          break;
        case 'alarm': {
          const entry: AlarmEntry = {
            id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            at: Date.now(),
            type: event.type,
            code: event.code,
          };
          // type 0 = ACK/heartbeat; ignore in UI but keep the very last one for debugging.
          if (event.type === 1) {
            setAlarms((prev) => [entry, ...prev].slice(0, MAX_RECENT_ALARMS));
            pushFalconAlarmToast({
              title: alarmLabel(event.code),
              code: event.code,
              tone: 'warning',
            });
          }
          break;
        }
        case 'module':
          setModuleList((prev) => {
            const idx = prev.findIndex((m) => m.module === event.module);
            const next: FalconDeviceModuleStatus = {
              module: event.module,
              curState: event.curState,
              isExist: event.isExist,
            };
            if (idx === -1) return [...prev, next];
            const out = [...prev];
            out[idx] = { ...out[idx], ...next };
            return out;
          });
          break;
        case 'raw':
          // Useful during development; left as a console.debug to avoid spam in production.
          console.debug('[falcon-ws] raw', event.text);
          break;
        default:
          break;
      }
    });

    void connectWs();

    return () => {
      cancelled = true;
      unsubscribe();
      void falconIpc.wsDisconnect().catch(() => {
        /* main process may already be shutting down */
      });
    };
  }, [connectWs]);

  // ── HTTP polling while running ──────────────────────────
  useEffect(() => {
    if (machineState !== 8) {
      // Clear stale progress so a new run starts from 0% visually.
      if (machineState === 2 && progress != null && progress < 100) {
        setProgress(null);
      }
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const [p, s] = await Promise.all([
          falconIpc.getProgress(ipRef.current),
          falconIpc.getState(ipRef.current).catch(() => machineStateRef.current ?? 0),
        ]);
        if (cancelled) return;
        setProgress(p);
        if (typeof s === 'number' && s !== machineStateRef.current) {
          setMachineState(s);
        }
      } catch (err) {
        if (cancelled) return;
        // Don't clobber the UI — just log. WS is the authoritative source.
        console.warn('[falcon] poll failed:', err);
      }
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [machineState, progress]);

  // ── Render ──────────────────────────────────────────────
  const stateName = falconStateName(machineState);
  const stateColor = falconStateColor(machineState);
  const isRunning = machineState === 8;
  const isFraming = machineState === 64;

  const connDotColor =
    connState === 'open' ? '#2dd4a0' : connState === 'connecting' ? '#f0b429' : '#ff4466';
  const connLabel =
    connState === 'open'
      ? 'Connected'
      : connState === 'connecting'
        ? 'Connecting…'
        : connState === 'closed'
          ? 'Disconnected'
          : 'Error';

  const sectionStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderBottom: '1px solid #1a1a2e',
    flexShrink: 0,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  };

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column' as const,
        height: '100%',
        overflowY: 'auto' as const,
        fontFamily: font,
      },
    },

    // Header
    React.createElement(
      'div',
      { style: { ...sectionStyle, display: 'flex', alignItems: 'center', gap: 10 } },
      React.createElement('div', {
        style: {
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: connDotColor,
          flexShrink: 0,
          boxShadow: connState === 'open' ? '0 0 6px rgba(45,212,160,0.6)' : 'none',
        },
        title: connError ?? connLabel,
      }),
      React.createElement(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        React.createElement(
          'div',
          { style: { fontSize: 13, fontWeight: 600, color: '#e0e0ec' } },
          'Falcon WiFi',
        ),
        React.createElement(
          'div',
          { style: { fontSize: 10, color: '#8888aa', fontFamily: mono, marginTop: 2 } },
          `${ip} · ${connLabel}`,
        ),
      ),
      connState !== 'open' &&
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => {
              void connectWs();
            },
            style: {
              padding: '5px 10px',
              fontSize: 11,
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: font,
              background: 'rgba(0, 212, 255, 0.08)',
              border: '1px solid #00d4ff',
              color: '#00d4ff',
            },
          },
          'Reconnect',
        ),
    ),

    // Machine state badge
    React.createElement(
      'div',
      { style: sectionStyle },
      React.createElement(
        'div',
        { style: { ...rowStyle, marginBottom: 6 } },
        React.createElement(
          'span',
          { style: { fontSize: 10, color: '#555570', textTransform: 'uppercase' as const, letterSpacing: 1 } },
          'State',
        ),
        React.createElement(
          'span',
          {
            style: {
              fontSize: 12,
              fontWeight: 700,
              color: stateColor,
              fontFamily: mono,
              padding: '3px 10px',
              borderRadius: 4,
              background: `${stateColor}14`,
              border: `1px solid ${stateColor}55`,
            },
          },
          stateName,
        ),
      ),
      (isRunning || isFraming) &&
        React.createElement(
          'div',
          { style: { marginTop: 8 } },
          React.createElement(
            'div',
            { style: { ...rowStyle, marginBottom: 4 } },
            React.createElement(
              'span',
              { style: { fontSize: 10, color: '#555570' } },
              isFraming ? 'Framing' : 'Progress',
            ),
            React.createElement(
              'span',
              { style: { fontSize: 11, color: '#e0e0ec', fontFamily: mono } },
              formatProgress(progress),
            ),
          ),
          React.createElement(
            'div',
            {
              style: {
                width: '100%',
                height: 6,
                background: '#0a0a14',
                borderRadius: 3,
                overflow: 'hidden',
              },
            },
            React.createElement('div', {
              style: {
                height: '100%',
                width: `${Math.max(0, Math.min(100, progress ?? 0))}%`,
                background: stateColor,
                transition: 'width 0.3s ease',
              },
            }),
          ),
        ),
    ),

    // Safety door
    React.createElement(
      'div',
      { style: sectionStyle },
      React.createElement(
        'div',
        rowStyle,
        React.createElement('span', { style: { fontSize: 11, color: '#8888aa' } }, 'Safety door'),
        doorOpen == null
          ? React.createElement(
              'span',
              { style: { fontSize: 11, color: '#555570', fontFamily: mono } },
              'unknown',
            )
          : React.createElement(
              'span',
              {
                style: {
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: mono,
                  color: doorOpen ? '#ffaa50' : '#2dd4a0',
                },
              },
              doorOpen ? 'OPEN ⚠' : 'CLOSED',
            ),
      ),
    ),

    // Collapsible machine info
    React.createElement(
      'div',
      { style: sectionStyle },
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => setInfoCollapsed((v) => !v),
          style: {
            width: '100%',
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: '#8888aa',
            fontSize: 11,
            fontFamily: font,
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
        },
        React.createElement('span', null, 'Machine info'),
        React.createElement('span', null, infoCollapsed ? '▼' : '▲'),
      ),
      !infoCollapsed &&
        React.createElement(
          'div',
          { style: { marginTop: 8, fontSize: 11, fontFamily: mono, color: '#c0c0d0' } },
          React.createElement(
            'div',
            rowStyle,
            React.createElement('span', { style: { color: '#8888aa' } }, 'Model'),
            React.createElement('span', null, deviceModel ?? '—'),
          ),
          React.createElement(
            'div',
            rowStyle,
            React.createElement('span', { style: { color: '#8888aa' } }, 'Firmware'),
            React.createElement('span', null, firmwareVersion ?? '—'),
          ),
          React.createElement(
            'div',
            rowStyle,
            React.createElement('span', { style: { color: '#8888aa' } }, 'Laser'),
            React.createElement(
              'span',
              null,
              laserInfo ? `${laserInfo.laserType} · ${laserInfo.laserClass}W` : '—',
            ),
          ),
          laserInfo?.laserSN &&
            React.createElement(
              'div',
              rowStyle,
              React.createElement('span', { style: { color: '#8888aa' } }, 'Laser SN'),
              React.createElement('span', null, laserInfo.laserSN),
            ),
          laserInfo?.zaxisVersion &&
            React.createElement(
              'div',
              rowStyle,
              React.createElement('span', { style: { color: '#8888aa' } }, 'Z-axis'),
              React.createElement('span', null, laserInfo.zaxisVersion),
            ),
          macAddress &&
            React.createElement(
              'div',
              rowStyle,
              React.createElement('span', { style: { color: '#8888aa' } }, 'MAC'),
              React.createElement('span', null, macAddress),
            ),
          moduleList.length > 0 &&
            React.createElement(
              'div',
              {
                style: {
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid #1a1a2e',
                  color: '#555570',
                  fontSize: 10,
                },
              },
              `${moduleList.length} module${moduleList.length === 1 ? '' : 's'} reported by device`,
            ),
        ),
    ),

    // Recent alarms
    React.createElement(
      'div',
      { style: sectionStyle },
      React.createElement(
        'div',
        {
          style: {
            fontSize: 10,
            color: '#555570',
            textTransform: 'uppercase' as const,
            letterSpacing: 1,
            marginBottom: 6,
          },
        },
        `Recent alarms (${alarms.length})`,
      ),
      alarms.length === 0
        ? React.createElement(
            'div',
            { style: { fontSize: 11, color: '#444460', fontStyle: 'italic' as const } },
            'No alarms.',
          )
        : React.createElement(
            'div',
            null,
            ...alarms.map((a) =>
              React.createElement(
                'div',
                {
                  key: a.id,
                  style: {
                    padding: '6px 8px',
                    marginBottom: 4,
                    borderRadius: 4,
                    background: 'rgba(255, 170, 80, 0.06)',
                    border: '1px solid rgba(255, 170, 80, 0.25)',
                    fontSize: 11,
                    fontFamily: mono,
                    color: '#ffaa50',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  },
                },
                React.createElement('span', null, alarmLabel(a.code)),
                React.createElement(
                  'span',
                  { style: { color: '#8888aa', fontSize: 10 } },
                  new Date(a.at).toLocaleTimeString(),
                ),
              ),
            ),
          ),
    ),

    // Security notice
    React.createElement(
      'div',
      { style: { ...sectionStyle, borderBottom: 'none', flex: 1 } },
      React.createElement(
        'div',
        {
          style: {
            padding: '8px 10px',
            fontSize: 10,
            color: '#555570',
            background: '#08080f',
            border: '1px solid #1a1a2e',
            borderRadius: 6,
            lineHeight: 1.4,
          },
        },
        React.createElement(
          'div',
          { style: { color: '#8888aa', fontWeight: 600, marginBottom: 3 } },
          'Security note',
        ),
        'Anyone on your local network can control this machine — there is no authentication. ' +
          'Keep your WiFi private and consider a DHCP reservation so the IP does not change.',
      ),
    ),

    // Footer
    onDisconnect &&
      React.createElement(
        'div',
        {
          style: {
            padding: '10px 14px',
            borderTop: '1px solid #1a1a2e',
            flexShrink: 0,
          },
        },
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: onDisconnect,
            style: {
              width: '100%',
              padding: 8,
              fontSize: 11,
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: font,
              background: 'transparent',
              border: '1px solid #252540',
              color: '#8888aa',
            },
          },
          'Disconnect',
        ),
      ),
  );
}
