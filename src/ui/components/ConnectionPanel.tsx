import React, { useState, useEffect, useRef } from 'react';
import { GrblController, type ConnectionState, type MachineStatus } from '../../core/controller/GrblController';
import { WebSerialController } from '../../core/controller/WebSerialController';

interface ConnectionPanelProps {
  gcode: string | null;
  onClose: () => void;
}

export function ConnectionPanel({ gcode, onClose }: ConnectionPanelProps) {
  const [ports, setPorts] = useState<{ path: string; manufacturer?: string }[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [status, setStatus] = useState<MachineStatus | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [manualCmd, setManualCmd] = useState('');
  const [usingWebSerial, setUsingWebSerial] = useState(false);
  const [webJobRunning, setWebJobRunning] = useState(false);
  const controllerRef = useRef<GrblController | null>(null);
  const webSerialRef = useRef<WebSerialController | null>(null);
  const jobAbortRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  useEffect(() => {
    const ctrl = new GrblController({
      onConnectionChange: setConnState,
      onStatusUpdate: setStatus,
      onMessage: (msg) => setMessages(prev => [...prev.slice(-200), msg]),
      onError: (err) => setMessages(prev => [...prev, `ERROR: ${err}`]),
      onProgress: (sent, total) => setProgress({ sent, total }),
      onJobComplete: () => setProgress(null),
    });
    controllerRef.current = ctrl;
    ctrl.listPorts().then(setPorts);

    return () => {
      void webSerialRef.current?.disconnect();
      webSerialRef.current = null;
      void ctrl.disconnect();
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const handleConnect = async () => {
    if (!selectedPort || !controllerRef.current) return;
    setUsingWebSerial(false);
    await controllerRef.current.connect(selectedPort);
  };

  const handleDisconnect = async () => {
    if (webSerialRef.current) {
      await webSerialRef.current.disconnect();
      webSerialRef.current = null;
      setUsingWebSerial(false);
    }
    await controllerRef.current?.disconnect();
  };

  const handleSendJob = async () => {
    if (!gcode || !controllerRef.current) return;
    await controllerRef.current.startJob(gcode);
  };

  const handleSendJobReal = async () => {
    if (!gcode || !webSerialRef.current) return;
    const lines = gcode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));

    setMessages(prev => [...prev, `Sending ${lines.length} commands to laser...`]);

    // Wait for GRBL to be ready (flush any startup messages)
    await new Promise(resolve => setTimeout(resolve, 2000));

    for (let i = 0; i < lines.length; i++) {
      try {
        const response = await webSerialRef.current.sendAndWait(lines[i], 30000);
        setProgress({ sent: i + 1, total: lines.length });

        if (response.startsWith('error:')) {
          setMessages(prev => [...prev, `GRBL error on line ${i + 1}: ${response}`]);
          const cont = confirm(`GRBL returned "${response}" on line ${i + 1}:\n${lines[i]}\n\nContinue anyway?`);
          if (!cont) {
            setMessages(prev => [...prev, 'Job stopped by user']);
            setProgress(null);
            return;
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages(prev => [...prev, `Error: ${msg}`]);
        alert(`Job failed at line ${i + 1}: ${msg}`);
        setProgress(null);
        return;
      }
    }

    setMessages(prev => [...prev, 'Job complete!']);
    setProgress(null);
  };

  const handleStartJobClick = async () => {
    if (usingWebSerial) await handleSendJobReal();
    else await handleSendJob();
  };

  const handleSendManual = async () => {
    if (!manualCmd.trim()) return;
    if (usingWebSerial && webSerialRef.current) {
      await webSerialRef.current.send(manualCmd);
      setManualCmd('');
      return;
    }
    if (!controllerRef.current) return;
    await controllerRef.current.send(manualCmd);
    setManualCmd('');
  };

  const btnStyle = (color: string, disabled?: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    background: disabled ? '#1a1a2e' : `rgba(${color}, 0.1)`,
    border: `1px solid ${disabled ? '#252540' : `rgba(${color}, 0.4)`}`,
    borderRadius: 6,
    color: disabled ? '#333355' : `rgb(${color})`,
    fontSize: 11,
    fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: font,
    opacity: disabled ? 0.5 : 1,
  });

  const isConnected = connState === 'connected';
  const isRunning = status?.state === 'run' || webJobRunning;
  const isSimPort = selectedPort === 'SIMULATOR';
  const totalLines = progress ? Math.max(progress.total, 1) : 1;

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 520, maxHeight: '85vh', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column' as const,
      },
    },
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          React.createElement('div', {
            style: {
              width: 8, height: 8, borderRadius: '50%',
              background: isConnected ? '#2dd4a0' : connState === 'connecting' ? '#ffd444' : '#ff4466',
              boxShadow: isConnected ? '0 0 8px rgba(45, 212, 160, 0.4)' : 'none',
            },
          }),
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Laser Connection'),
          isSimPort && isConnected &&
            React.createElement('span', { style: { fontSize: 9, color: '#ffd444', background: 'rgba(255,212,68,0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,212,68,0.2)' } }, 'SIMULATOR'),
          usingWebSerial && isConnected &&
            React.createElement('span', { style: { fontSize: 9, color: '#2dd4a0', background: 'rgba(45,212,160,0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(45,212,160,0.2)' } }, 'WEB SERIAL'),
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
        }, '×'),
      ),

      React.createElement('div', { style: { padding: '12px 18px', borderBottom: '1px solid #1a1a2e' } },
        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#8888aa', marginBottom: 3 } }, 'Serial Port'),
            React.createElement('select', {
              value: selectedPort,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setSelectedPort(e.target.value),
              disabled: isConnected,
              style: {
                width: '100%', padding: '6px 8px',
                background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
                color: '#e0e0ec', fontSize: 12, fontFamily: mono, outline: 'none',
              },
            },
              React.createElement('option', { value: '' }, '— Select port —'),
              ...ports.map(p => React.createElement('option', { key: p.path, value: p.path },
                `${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ''}`
              )),
            ),
          ),
          !isConnected
            ? React.createElement('button', {
                onClick: handleConnect,
                disabled: !selectedPort,
                style: btnStyle('0, 212, 255', !selectedPort),
              }, 'Connect')
            : React.createElement('button', {
                onClick: handleDisconnect,
                style: btnStyle('255, 68, 102'),
              }, 'Disconnect'),
          React.createElement('button', {
            onClick: () => controllerRef.current?.listPorts().then(setPorts),
            style: { ...btnStyle('136, 136, 170'), padding: '6px 10px' },
          }, '↻'),
        ),
      ),

      !isConnected && WebSerialController.isSupported() && React.createElement('div', {
        style: { padding: '8px 18px', borderBottom: '1px solid #1a1a2e' },
      },
        React.createElement('div', { style: { fontSize: 10, color: '#8888aa', marginBottom: 6 } }, 'Or connect to a real laser:'),
        React.createElement('button', {
          onClick: async () => {
            const ws = new WebSerialController({
              onConnectionChange: setConnState,
              onMessage: (msg) => setMessages(prev => [...prev.slice(-200), msg]),
              onError: (err) => setMessages(prev => [...prev, `ERROR: ${err}`]),
            });
            webSerialRef.current = ws;

            const hasPort = await ws.requestPort();
            if (!hasPort) {
              webSerialRef.current = null;
              return;
            }
            const connected = await ws.connect(115200);
            if (connected) {
              setUsingWebSerial(true);
              setMessages(prev => [...prev, 'Real laser connected via Web Serial']);
            } else {
              webSerialRef.current = null;
            }
          },
          style: {
            width: '100%', padding: '10px',
            background: 'rgba(45, 212, 160, 0.08)',
            border: '1px solid rgba(45, 212, 160, 0.3)',
            borderRadius: 8, color: '#2dd4a0',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'DM Sans', system-ui, sans-serif",
          },
        }, 'Select USB Port (Real Laser)'),
      ),

      isConnected && React.createElement('div', { style: { padding: '12px 18px', borderBottom: '1px solid #1a1a2e' } },
        React.createElement('div', { style: { display: 'flex', gap: 16, marginBottom: 10 } },
          React.createElement('div', { style: { flex: 1, background: '#0a0a14', borderRadius: 6, padding: '8px 12px', border: '1px solid #1a1a2e' } },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'POSITION'),
            React.createElement('div', { style: { fontFamily: mono, fontSize: 16, color: '#e0e0ec' } },
              `X${status?.x.toFixed(2) || '0.00'}  Y${status?.y.toFixed(2) || '0.00'}`
            ),
          ),
          React.createElement('div', { style: { background: '#0a0a14', borderRadius: 6, padding: '8px 12px', border: '1px solid #1a1a2e' } },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'STATE'),
            React.createElement('div', { style: {
              fontFamily: mono, fontSize: 14, fontWeight: 600,
              color: status?.state === 'idle' ? '#2dd4a0' : status?.state === 'run' ? '#00d4ff' : status?.state === 'alarm' ? '#ff4466' : '#ffd444',
            } }, status?.state?.toUpperCase() || 'IDLE'),
          ),
        ),

        React.createElement('div', { style: { display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 8 } },
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 36px)', gap: 3 } },
            React.createElement('div'),
            React.createElement('button', { onClick: () => {
              if (usingWebSerial && webSerialRef.current) void webSerialRef.current.send('$J=G91 X0 Y-10 F1000');
              else void controllerRef.current?.jog(0, -10);
            }, style: { ...btnStyle('136, 136, 170'), padding: '6px', fontSize: 12 } }, '↑'),
            React.createElement('div'),
            React.createElement('button', { onClick: () => {
              if (usingWebSerial && webSerialRef.current) void webSerialRef.current.send('$J=G91 X-10 Y0 F1000');
              else void controllerRef.current?.jog(-10, 0);
            }, style: { ...btnStyle('136, 136, 170'), padding: '6px', fontSize: 12 } }, '←'),
            React.createElement('button', { onClick: () => {
              if (usingWebSerial && webSerialRef.current) void webSerialRef.current.send('$H');
              else void controllerRef.current?.home();
            }, style: { ...btnStyle('45, 212, 160'), padding: '6px', fontSize: 9 } }, '⌂'),
            React.createElement('button', { onClick: () => {
              if (usingWebSerial && webSerialRef.current) void webSerialRef.current.send('$J=G91 X10 Y0 F1000');
              else void controllerRef.current?.jog(10, 0);
            }, style: { ...btnStyle('136, 136, 170'), padding: '6px', fontSize: 12 } }, '→'),
            React.createElement('div'),
            React.createElement('button', { onClick: () => {
              if (usingWebSerial && webSerialRef.current) void webSerialRef.current.send('$J=G91 X0 Y10 F1000');
              else void controllerRef.current?.jog(0, 10);
            }, style: { ...btnStyle('136, 136, 170'), padding: '6px', fontSize: 12 } }, '↓'),
            React.createElement('div'),
          ),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 3, marginLeft: 12 } },
            React.createElement('button', { onClick: () => {
              if (usingWebSerial && webSerialRef.current) void webSerialRef.current.send('$X');
              else void controllerRef.current?.unlock();
            }, style: { ...btnStyle('255, 212, 68'), fontSize: 10, padding: '4px 10px' } }, 'Unlock'),
            React.createElement('button', { onClick: () => {
              if (usingWebSerial && webSerialRef.current) {
                void webSerialRef.current.send('M4 S50');
                setTimeout(() => { void webSerialRef.current?.send('M5 S0'); }, 500);
              } else void controllerRef.current?.laserTest(5, 500);
            }, style: { ...btnStyle('255, 136, 68'), fontSize: 10, padding: '4px 10px' } }, 'Test Fire'),
          ),
        ),

        React.createElement('div', { style: { display: 'flex', gap: 6 } },
          React.createElement('button', {
            onClick: () => void handleStartJobClick(),
            disabled: !gcode || isRunning,
            style: { ...btnStyle('45, 212, 160', !gcode || isRunning), flex: 1, fontWeight: 600 },
          }, isRunning ? 'Running...' : 'Start Job'),
          isRunning && !usingWebSerial && React.createElement('button', {
            onClick: () => controllerRef.current?.pause(),
            style: btnStyle('255, 212, 68'),
          }, 'Pause'),
          isRunning && React.createElement('button', {
            onClick: () => {
              jobAbortRef.current = true;
              controllerRef.current?.stopJob();
              setProgress(null);
            },
            style: btnStyle('255, 68, 102'),
          }, 'Stop'),
        ),

        progress && React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555570', marginBottom: 3 } },
            React.createElement('span', null, `Line ${progress.sent} / ${progress.total}`),
            React.createElement('span', null, `${Math.round(progress.sent / totalLines * 100)}%`),
          ),
          React.createElement('div', { style: { height: 3, background: '#1a1a2e', borderRadius: 2, overflow: 'hidden' } },
            React.createElement('div', { style: { width: `${(progress.sent / totalLines) * 100}%`, height: '100%', background: '#00d4ff', borderRadius: 2, transition: 'width 0.1s' } }),
          ),
        ),
      ),

      React.createElement('div', {
        ref: logRef,
        style: {
          flex: 1, minHeight: 150, maxHeight: 250,
          padding: '8px 12px', margin: '8px 18px',
          background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e',
          overflow: 'auto', fontFamily: mono, fontSize: 10, lineHeight: 1.5,
        },
      },
        messages.length === 0
          ? React.createElement('span', { style: { color: '#333355' } }, 'Console output will appear here...')
          : messages.map((msg, i) =>
              React.createElement('div', {
                key: i,
                style: { color: msg.startsWith('ERROR') ? '#ff4466' : msg.startsWith('>') ? '#00d4ff' : '#555570' },
              }, msg)
            ),
      ),

      isConnected && React.createElement('div', {
        style: { padding: '8px 18px', display: 'flex', gap: 6 },
      },
        React.createElement('input', {
          type: 'text',
          value: manualCmd,
          placeholder: 'G-code command...',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setManualCmd(e.target.value),
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') void handleSendManual(); },
          style: {
            flex: 1, padding: '6px 10px',
            background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
            color: '#e0e0ec', fontSize: 11, fontFamily: mono, outline: 'none',
          },
        }),
        React.createElement('button', {
          onClick: () => void handleSendManual(),
          style: btnStyle('0, 212, 255'),
        }, 'Send'),
      ),

      React.createElement('div', {
        style: { padding: '10px 18px', borderTop: '1px solid #1a1a2e', fontSize: 10, color: '#444460' },
      }, 'Supports GRBL 1.1+ via Web Serial (USB) or SIMULATOR. No native drivers required in Chromium/Electron.'),
    ),
  );
}
