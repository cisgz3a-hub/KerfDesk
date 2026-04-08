import React, { useState, useEffect, useRef } from 'react';
import { GrblController } from '../../controllers/grbl/GrblController';
import { MockSerialPort } from '../../communication/SerialPort';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { estimateJobTime } from '../../core/output/TimeEstimator';

interface ConnectionPanelProps {
  gcode: string | null;
  bedWidth: number;
  bedHeight: number;
  boundsMinX?: number;
  boundsMinY?: number;
  boundsMaxX?: number;
  boundsMaxY?: number;
  onClose: () => void;
}

export function ConnectionPanel({ gcode, bedWidth, bedHeight, boundsMinX, boundsMinY, boundsMaxX, boundsMaxY, onClose }: ConnectionPanelProps) {
  const [machineState, setMachineState] = useState<MachineState | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [isSimulator, setIsSimulator] = useState(false);
  const [jogStep, setJogStep] = useState(10);
  const [manualCmd, setManualCmd] = useState('');

  const controllerRef = useRef<GrblController | null>(null);
  const portRef = useRef<WebSerialPort | MockSerialPort | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  // Initialize controller
  useEffect(() => {
    const ctrl = new GrblController();

    ctrl.onStateChange((state) => setMachineState({ ...state }));
    ctrl.onProgress((prog) => setProgress({ ...prog }));
    ctrl.onError((code, msg) => setMessages(prev => [...prev.slice(-200), `ERROR ${code}: ${msg}`]));
    ctrl.onRawLine((line, dir) => setMessages(prev => [...prev.slice(-200), `${dir === 'tx' ? '>' : '<'} ${line}`]));

    controllerRef.current = ctrl;

    return () => { void ctrl.disconnect(); };
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const isConnected = machineState?.status !== 'disconnected' && machineState?.status !== 'connecting' && machineState !== null;
  const isRunning = controllerRef.current?.isJobRunning || false;

  // ─── Connection handlers ─────────────────────────────────

  const connectSimulator = async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    const mock = new MockSerialPort();
    portRef.current = mock;
    mock.open();
    try {
      await ctrl.connect(mock);
      setIsSimulator(true);
      setMessages(prev => [...prev, '✓ Simulator connected']);
    } catch (e: any) {
      setMessages(prev => [...prev, `Connection failed: ${e.message}`]);
    }
  };

  const connectRealLaser = async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    if (!WebSerialPort.isSupported()) {
      setMessages(prev => [...prev, 'ERROR: Web Serial not supported in this browser']);
      return;
    }

    const ws = new WebSerialPort();
    portRef.current = ws;
    try {
      await ws.requestAndOpen(115200);
      setMessages(prev => [...prev, 'Port opened, waiting for GRBL welcome...']);
      await ctrl.connect(ws);
      setIsSimulator(false);
      setMessages(prev => [...prev, '✓ Real laser connected via USB']);
    } catch (e: any) {
      setMessages(prev => [...prev, `Connection failed: ${e.message}`]);
    }
  };

  const handleDisconnect = async () => {
    await controllerRef.current?.disconnect();
    portRef.current = null;
    setMachineState(null);
    setProgress(null);
    setMessages(prev => [...prev, 'Disconnected']);
  };

  // ─── Machine control ────────────────────────────────────

  const sendCmd = (cmd: string) => {
    try { controllerRef.current?.sendCommand(cmd); } catch { /* ignore */ }
  };

  const handleStartJob = () => {
    if (!gcode || !controllerRef.current) return;
    const lines = gcode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));

    // Pre-flight bounds check
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const line of lines) {
      const xm = line.match(/X([-\d.]+)/);
      const ym = line.match(/Y([-\d.]+)/);
      if (xm) { const x = parseFloat(xm[1]); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      if (ym) { const y = parseFloat(ym[1]); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    const warnings: string[] = [];
    if (minX < 0) warnings.push(`Negative X (${minX.toFixed(1)}mm)`);
    if (minY < 0) warnings.push(`Negative Y (${minY.toFixed(1)}mm)`);
    if (maxX > bedWidth) warnings.push(`X exceeds bed (${maxX.toFixed(1)}mm > ${bedWidth}mm)`);
    if (maxY > bedHeight) warnings.push(`Y exceeds bed (${maxY.toFixed(1)}mm > ${bedHeight}mm)`);

    if (warnings.length > 0) {
      if (!confirm('Warnings:\n' + warnings.join('\n') + '\n\nSend anyway?')) return;
    }

    setMessages(prev => [...prev, `Starting job: ${lines.length} commands`]);
    try {
      controllerRef.current.sendJob(lines);
    } catch (e: any) {
      setMessages(prev => [...prev, `Failed to start: ${e.message}`]);
    }
  };

  const handleFrame = async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    const x1 = boundsMinX ?? 0;
    const y1 = boundsMinY ?? 0;
    const x2 = boundsMaxX ?? 100;
    const y2 = boundsMaxY ?? 100;

    setMessages(prev => [...prev, `Framing: X${x1.toFixed(0)}-${x2.toFixed(0)} Y${y1.toFixed(0)}-${y2.toFixed(0)}`]);

    const cmds = [
      'G21', 'G90', 'M4 S10',
      `G0 X${x1.toFixed(2)} Y${y1.toFixed(2)}`,
      `G1 X${x2.toFixed(2)} Y${y1.toFixed(2)} F2000`,
      `G1 X${x2.toFixed(2)} Y${y2.toFixed(2)} F2000`,
      `G1 X${x1.toFixed(2)} Y${y2.toFixed(2)} F2000`,
      `G1 X${x1.toFixed(2)} Y${y1.toFixed(2)} F2000`,
      'M5 S0',
    ];

    for (const cmd of cmds) {
      try { ctrl.sendCommand(cmd); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 50));
    }

    setMessages(prev => [...prev, '✓ Frame complete']);
  };

  // ─── Styles ─────────────────────────────────────────────

  const btnStyle = (color: string, disabled?: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    background: disabled ? '#1a1a2e' : `rgba(${color}, 0.1)`,
    border: `1px solid ${disabled ? '#252540' : `rgba(${color}, 0.4)`}`,
    borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
    fontFamily: font, opacity: disabled ? 0.5 : 1,
    color: disabled ? '#333355' : `rgb(${color})`,
  });

  // ─── Render ─────────────────────────────────────────────

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 2000, fontFamily: font,
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
      // Header
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          React.createElement('div', {
            style: {
              width: 8, height: 8, borderRadius: '50%',
              background: isConnected ? '#2dd4a0' : '#ff4466',
              boxShadow: isConnected ? '0 0 8px rgba(45,212,160,0.4)' : 'none',
            },
          }),
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Laser Connection'),
          isSimulator && isConnected && React.createElement('span', {
            style: { fontSize: 9, color: '#ffd444', background: 'rgba(255,212,68,0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,212,68,0.2)' },
          }, 'SIMULATOR'),
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
        }, '×'),
      ),

      // Connect section
      !isConnected && React.createElement('div', { style: { padding: '16px 18px', borderBottom: '1px solid #1a1a2e' } },
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            onClick: connectSimulator,
            style: { ...btnStyle('255, 212, 68'), flex: 1, padding: '12px' },
          }, 'Simulator'),
          WebSerialPort.isSupported() && React.createElement('button', {
            onClick: connectRealLaser,
            style: { ...btnStyle('45, 212, 160'), flex: 1, padding: '12px', fontWeight: 600 },
          }, 'Select USB Port'),
        ),
        React.createElement('div', { style: { fontSize: 10, color: '#555570', marginTop: 8, textAlign: 'center' as const } },
          'Simulator for testing. USB for real laser (GRBL 1.1+).'
        ),
      ),

      // Disconnect
      isConnected && React.createElement('div', { style: { padding: '8px 18px', display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('button', { onClick: handleDisconnect, style: btnStyle('255, 68, 102') }, 'Disconnect'),
      ),

      // Quick start guide
      isConnected && React.createElement('div', {
        style: { padding: '8px 18px', background: 'rgba(0,212,255,0.04)', borderBottom: '1px solid #1a1a2e', fontSize: 11, color: '#8888aa', lineHeight: 1.5 },
      },
        React.createElement('strong', { style: { color: '#00d4ff', fontSize: 10, display: 'block', marginBottom: 4 } }, 'QUICK START'),
        '1. Jog laser to your workpiece corner', React.createElement('br'),
        '2. Click ZERO to set starting point', React.createElement('br'),
        '3. Click Frame to verify, then Start Job',
      ),

      // Position + state
      isConnected && React.createElement('div', { style: { padding: '8px 18px', display: 'flex', gap: 16 } },
        React.createElement('div', { style: { flex: 1, background: '#0a0a14', borderRadius: 6, padding: '8px 12px', border: '1px solid #1a1a2e' } },
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'POSITION'),
          React.createElement('div', { style: { fontFamily: mono, fontSize: 16, color: '#e0e0ec' } },
            `X${machineState?.position.x.toFixed(2) || '0.00'}  Y${machineState?.position.y.toFixed(2) || '0.00'}`
          ),
        ),
        React.createElement('div', { style: { background: '#0a0a14', borderRadius: 6, padding: '8px 12px', border: '1px solid #1a1a2e' } },
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'STATE'),
          React.createElement('div', { style: {
            fontFamily: mono, fontSize: 14, fontWeight: 600,
            color: machineState?.status === 'idle' ? '#2dd4a0' : machineState?.status === 'run' ? '#00d4ff' : machineState?.status === 'alarm' ? '#ff4466' : '#ffd444',
          } }, (machineState?.status || 'IDLE').toUpperCase()),
        ),
        React.createElement('div', { style: { background: '#0a0a14', borderRadius: 6, padding: '8px 12px', border: '1px solid #1a1a2e' } },
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'BUFFER'),
          React.createElement('div', { style: { fontFamily: mono, fontSize: 14, color: '#8888aa' } },
            `${progress?.bufferFill || 0}/127`
          ),
        ),
      ),

      // Jog controls
      isConnected && React.createElement('div', { style: { padding: '8px 18px' } },
        // Step selector
        React.createElement('div', { style: { display: 'flex', gap: 3, justifyContent: 'center', marginBottom: 6 } },
          ...[1, 10, 50].map(step =>
            React.createElement('button', {
              key: step, onClick: () => setJogStep(step),
              style: {
                padding: '3px 10px', fontSize: 10, fontFamily: mono, cursor: 'pointer',
                background: jogStep === step ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: jogStep === step ? '1px solid #00d4ff' : '1px solid #252540',
                borderRadius: 4, color: jogStep === step ? '#00d4ff' : '#555570',
              },
            }, `${step}mm`),
          ),
        ),
        // Arrow pad + side buttons
        React.createElement('div', { style: { display: 'flex', gap: 4, justifyContent: 'center' } },
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 36px)', gap: 3 } },
            React.createElement('div'),
            React.createElement('button', { onClick: () => sendCmd(`$J=G91 Y-${jogStep} F1000`), style: { ...btnStyle('136,136,170'), padding: '6px', fontSize: 12 } }, '↑'),
            React.createElement('div'),
            React.createElement('button', { onClick: () => sendCmd(`$J=G91 X-${jogStep} F1000`), style: { ...btnStyle('136,136,170'), padding: '6px', fontSize: 12 } }, '←'),
            React.createElement('button', {
              onClick: () => { sendCmd('G10 L20 P1 X0 Y0'); setMachineState(prev => prev ? { ...prev, position: { ...prev.position, x: 0, y: 0 } } : prev); },
              title: 'Set current position as X0 Y0',
              style: { ...btnStyle('0,212,255'), padding: '6px', fontSize: 8, fontWeight: 700 },
            }, 'ZERO'),
            React.createElement('button', { onClick: () => sendCmd(`$J=G91 X${jogStep} F1000`), style: { ...btnStyle('136,136,170'), padding: '6px', fontSize: 12 } }, '→'),
            React.createElement('div'),
            React.createElement('button', { onClick: () => sendCmd(`$J=G91 Y${jogStep} F1000`), style: { ...btnStyle('136,136,170'), padding: '6px', fontSize: 12 } }, '↓'),
            React.createElement('div'),
          ),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 3, marginLeft: 12 } },
            React.createElement('button', { onClick: () => sendCmd('$X'), style: { ...btnStyle('255,212,68'), fontSize: 10, padding: '4px 10px' } }, 'Unlock'),
            React.createElement('button', {
              onClick: () => { sendCmd('M4 S50'); setTimeout(() => sendCmd('M5 S0'), 500); },
              style: { ...btnStyle('255,136,68'), fontSize: 10, padding: '4px 10px' },
            }, 'Test Fire'),
            React.createElement('button', {
              onClick: () => { if (confirm('Homing moves to limit switches. Continue?')) sendCmd('$H'); },
              style: { ...btnStyle('136,136,170'), fontSize: 10, padding: '4px 10px' },
            }, 'Home'),
          ),
        ),
      ),

      // Time estimate + job buttons
      isConnected && React.createElement('div', { style: { padding: '8px 18px' } },
        gcode && React.createElement('div', {
          style: { padding: '6px 12px', marginBottom: 6, background: '#0a0a14', borderRadius: 6, border: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', fontSize: 11 },
        },
          React.createElement('span', { style: { color: '#8888aa' } }, 'Estimated time'),
          React.createElement('span', { style: { color: '#00d4ff', fontFamily: mono, fontWeight: 600 } }, estimateJobTime(gcode).formatted),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 6 } },
          React.createElement('button', {
            onClick: handleFrame, disabled: !isConnected,
            style: { ...btnStyle('255,212,68', !isConnected), flex: 1 },
          }, 'Frame'),
          React.createElement('button', {
            onClick: handleStartJob, disabled: !gcode || isRunning,
            style: { ...btnStyle('45,212,160', !gcode || isRunning), flex: 1, fontWeight: 600 },
          }, isRunning ? 'Running...' : `Start Job${isSimulator ? ' (Sim)' : ''}`),
        ),
        // Pause/Resume/Stop when running
        isRunning && React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
          React.createElement('button', {
            onClick: () => controllerRef.current?.pause(),
            style: { ...btnStyle('255,212,68'), flex: 1 },
          }, 'Pause'),
          React.createElement('button', {
            onClick: () => controllerRef.current?.resume(),
            style: { ...btnStyle('45,212,160'), flex: 1 },
          }, 'Resume'),
          React.createElement('button', {
            onClick: () => controllerRef.current?.stop(),
            style: { ...btnStyle('255,68,102'), flex: 1 },
          }, 'Stop'),
        ),
        // Progress bar
        progress && progress.totalLines > 0 && React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555570', marginBottom: 3 } },
            React.createElement('span', null, `${progress.linesAcknowledged} / ${progress.totalLines} acknowledged`),
            React.createElement('span', null, `${progress.percentComplete.toFixed(0)}%`),
          ),
          React.createElement('div', { style: { height: 3, background: '#1a1a2e', borderRadius: 2, overflow: 'hidden' } },
            React.createElement('div', { style: { width: `${progress.percentComplete}%`, height: '100%', background: '#00d4ff', borderRadius: 2, transition: 'width 0.1s' } }),
          ),
        ),
      ),

      // Emergency stop
      isConnected && React.createElement('div', { style: { padding: '4px 18px' } },
        React.createElement('button', {
          onClick: () => {
            controllerRef.current?.stop();
            sendCmd('M5 S0');
            setMessages(prev => [...prev, '⚠ EMERGENCY STOP']);
          },
          style: { width: '100%', padding: '8px', background: 'rgba(255,68,102,0.1)', border: '1px solid #ff4466', borderRadius: 6, color: '#ff4466', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: font },
        }, '⚠ EMERGENCY STOP'),
      ),

      // Console
      React.createElement('div', {
        ref: logRef,
        style: { flex: 1, minHeight: 120, maxHeight: 200, padding: '8px 12px', margin: '8px 18px', background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e', overflow: 'auto', fontFamily: mono, fontSize: 10, lineHeight: 1.5 },
      },
        messages.length === 0
          ? React.createElement('span', { style: { color: '#333355' } }, 'Console...')
          : messages.map((msg, i) =>
              React.createElement('div', { key: i, style: { color: msg.startsWith('ERROR') || msg.startsWith('⚠') ? '#ff4466' : msg.startsWith('>') ? '#00d4ff' : msg.startsWith('✓') ? '#2dd4a0' : '#555570' } }, msg),
            ),
      ),

      // Manual command
      isConnected && React.createElement('div', { style: { padding: '8px 18px 12px', display: 'flex', gap: 6 } },
        React.createElement('input', {
          type: 'text', value: manualCmd, placeholder: 'G-code command...',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setManualCmd(e.target.value),
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') { sendCmd(manualCmd); setManualCmd(''); } },
          style: { flex: 1, padding: '6px 10px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: '#e0e0ec', fontSize: 11, fontFamily: mono, outline: 'none' },
        }),
        React.createElement('button', { onClick: () => { sendCmd(manualCmd); setManualCmd(''); }, style: btnStyle('0,212,255') }, 'Send'),
      ),

      // Footer
      React.createElement('div', {
        style: { padding: '8px 18px', borderTop: '1px solid #1a1a2e', fontSize: 10, color: '#444460' },
      }, 'GRBL 1.1+ · Character-counting buffer · 5Hz status polling'),
    ),
  );
}
