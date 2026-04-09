import React, { useState, useEffect, useRef } from 'react';
import { GrblController } from '../../controllers/grbl/GrblController';
import { MockSerialPort } from '../../communication/SerialPort';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { estimateJobTime } from '../../core/output/TimeEstimator';
import { type Scene } from '../../core/scene/Scene';
import { runPreflight, type PreflightResult, type PreflightIssue } from '../../core/preflight/PreflightChecker';

interface ConnectionPanelProps {
  scene: Scene;
  gcode: string | null;
  bedWidth: number;
  bedHeight: number;
  boundsMinX?: number;
  boundsMinY?: number;
  boundsMaxX?: number;
  boundsMaxY?: number;
  onClose: () => void;
}

export function ConnectionPanel({ scene, gcode, bedWidth, bedHeight, boundsMinX, boundsMinY, boundsMaxX, boundsMaxY, onClose }: ConnectionPanelProps) {
  const [machineState, setMachineState] = useState<MachineState | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
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

  useEffect(() => {
    if (!scene) return;
    const result = runPreflight(scene, gcode, machineState, bedWidth, bedHeight);
    setPreflight(result);
  }, [gcode, machineState, scene, bedWidth, bedHeight]);

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

    // Use preflight to gate job start
    if (preflight && !preflight.canStart) {
      alert('Cannot start job — resolve all blockers first:\n\n' +
        preflight.issues
          .filter(i => i.severity === 'blocker')
          .map(i => `• ${i.title}`)
          .join('\n')
      );
      return;
    }

    const lines = gcode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));
    setMessages(prev => [...prev, `Starting job: ${lines.length} commands (score: ${preflight?.score ?? '?'}%)`]);
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

  const handleProofRun = () => {
    if (!gcode || !controllerRef.current) return;

    // Convert G-code to proof mode: replace all S-values with S0, keep all motion
    const proofLines = gcode
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith(';'))
      .map(line => {
        // Replace any S-value with S0 (laser off)
        if (line.match(/S\d/)) {
          return line.replace(/S\d+/g, 'S0') + ' ; PROOF';
        }
        // Replace M4/M3 laser-on with M4 S0
        if (line.startsWith('M4 ') || line.startsWith('M3 ')) {
          return 'M4 S0 ; PROOF';
        }
        return line;
      });

    // Use preflight to gate
    if (preflight && preflight.issues.some(i => i.severity === 'blocker' && i.id !== 'output-no-gcode')) {
      const machineBlockers = preflight.issues.filter(i => i.severity === 'blocker' && i.category === 'machine');
      if (machineBlockers.length > 0) {
        alert('Cannot run proof — resolve machine blockers first:\n\n' +
          machineBlockers.map(i => `• ${i.title}`).join('\n'));
        return;
      }
    }

    setMessages(prev => [...prev, `PROOF RUN: ${proofLines.length} commands (laser OFF)`]);
    try {
      controllerRef.current.sendJob(proofLines);
    } catch (e: any) {
      setMessages(prev => [...prev, `Proof run failed: ${e.message}`]);
    }
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

      // Readiness Score
      isConnected && preflight && React.createElement('div', {
        style: {
          padding: '12px 18px', borderBottom: '1px solid #1a1a2e',
        },
      },
        // Score badge
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
        },
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 10 },
          },
            React.createElement('div', {
              style: {
                width: 44, height: 44, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, fontFamily: mono,
                background: preflight.score >= 80 ? 'rgba(45,212,160,0.1)' :
                            preflight.score >= 50 ? 'rgba(255,212,68,0.1)' :
                            'rgba(255,68,102,0.1)',
                border: `2px solid ${preflight.score >= 80 ? '#2dd4a0' : preflight.score >= 50 ? '#ffd444' : '#ff4466'}`,
                color: preflight.score >= 80 ? '#2dd4a0' : preflight.score >= 50 ? '#ffd444' : '#ff4466',
              },
            }, `${preflight.score}`),
            React.createElement('div', null,
              React.createElement('div', {
                style: { fontSize: 12, fontWeight: 600, color: '#e0e0ec' },
              }, preflight.canStart ? 'Ready to cut' : 'Not ready'),
              React.createElement('div', {
                style: { fontSize: 10, color: '#555570' },
              }, `${preflight.blockers} blocker${preflight.blockers !== 1 ? 's' : ''}, ${preflight.warnings} warning${preflight.warnings !== 1 ? 's' : ''}`),
            ),
          ),
        ),

        // Issue list (collapsed by default, show blockers and warnings)
        ...(preflight.issues.filter(i => i.severity !== 'info').map(issue =>
          React.createElement('div', {
            key: issue.id,
            style: {
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '6px 0', fontSize: 11, lineHeight: 1.4,
            },
          },
            React.createElement('span', {
              style: {
                fontSize: 10, marginTop: 2, flexShrink: 0,
                color: issue.severity === 'blocker' ? '#ff4466' : '#ffd444',
              },
            }, issue.severity === 'blocker' ? '●' : '▲'),
            React.createElement('div', null,
              React.createElement('div', { style: { color: '#e0e0ec', fontWeight: 500 } }, issue.title),
              issue.fix && React.createElement('div', { style: { color: '#555570', fontSize: 10 } }, issue.fix),
            ),
          ),
        )),
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
            onClick: handleProofRun, disabled: !gcode || isRunning,
            title: 'Run the full job with laser OFF — verify motion path on the real machine',
            style: { ...btnStyle('136,180,255', !gcode || isRunning), flex: 1 },
          }, 'Proof'),
          React.createElement('button', {
            onClick: handleStartJob, disabled: !gcode || isRunning || (preflight ? !preflight.canStart : false),
            style: { ...btnStyle('45,212,160', !gcode || isRunning || (preflight ? !preflight.canStart : false)), flex: 1, fontWeight: 600 },
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
