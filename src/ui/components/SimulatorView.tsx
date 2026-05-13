import React, { useState, useEffect, useRef, useCallback } from 'react';
import { type MachineOriginCorner } from '../../core/devices/DeviceProfile';
import { shouldFlipYForFrontOrigin } from '../../core/plan/MachineTransform';

interface SimulatorViewProps {
  onSubscribe: (callback: (line: string) => void) => () => void;
  bedWidth: number;
  bedHeight: number;
  originCorner: MachineOriginCorner;
  /** GRBL work position (WPos from status); drives head marker always — MPos is source of truth */
  liveHead: { x: number; y: number } | null;
  jobRunning: boolean;
}

interface MachineState {
  /** Machine position (MPos), mm — drawing / cut paths use this space */
  x: number;
  y: number;
  laserOn: boolean;
  laserPower: number;
  feedRate: number;
  workOffsetX: number;
  workOffsetY: number;
  /** G90 absolute work coords vs G91 incremental machine deltas */
  isAbsolute: boolean;
}

export function mapMachineYToCanvasY(
  machineY: number,
  bedHeight: number,
  originCorner: MachineOriginCorner,
): number {
  return shouldFlipYForFrontOrigin(originCorner) ? (bedHeight - machineY) : machineY;
}

export function SimulatorView({
  onSubscribe,
  bedWidth,
  bedHeight,
  originCorner,
  liveHead,
  jobRunning,
}: SimulatorViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<MachineState>({
    x: 0,
    y: 0,
    laserOn: false,
    laserPower: 0,
    feedRate: 1000,
    workOffsetX: 0,
    workOffsetY: 0,
    isAbsolute: true,
  });
  const pathRef = useRef<Array<{ from: { x: number; y: number }; to: { x: number; y: number }; power: number }>>([]);
  const zeroRef = useRef<{ x: number; y: number } | null>(null);
  /** Running XY for gcode echo (trail segments). Kept in sync with state when idle; advances on every move line during jobs while state.x/y follow liveHead. */
  const trailCursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const drawRef = useRef<() => void>(() => {});

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = stateRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, w, h);

    const pad = 30;
    const scale = Math.min((w - pad * 2) / bedWidth, (h - pad * 2) / bedHeight);
    const ox = (w - bedWidth * scale) / 2;
    const oy = (h - bedHeight * scale) / 2;
    const toCanvasY = (machineY: number) =>
      oy + mapMachineYToCanvasY(machineY, bedHeight, originCorner) * scale;

    ctx.strokeStyle = '#252540';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, bedWidth * scale, bedHeight * scale);

    ctx.strokeStyle = '#12121e';
    ctx.lineWidth = 0.5;
    const gridStep = 50;
    for (let gx = gridStep; gx < bedWidth; gx += gridStep) {
      ctx.beginPath();
      ctx.moveTo(ox + gx * scale, oy);
      ctx.lineTo(ox + gx * scale, oy + bedHeight * scale);
      ctx.stroke();
    }
    for (let gy = gridStep; gy < bedHeight; gy += gridStep) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + gy * scale);
      ctx.lineTo(ox + bedWidth * scale, oy + gy * scale);
      ctx.stroke();
    }

    const zm = zeroRef.current;
    if (zm) {
      const woX = ox + zm.x * scale;
      const woY = toCanvasY(zm.y);
      ctx.strokeStyle = '#ffd444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(woX - 8, woY);
      ctx.lineTo(woX + 8, woY);
      ctx.moveTo(woX, woY - 8);
      ctx.lineTo(woX, woY + 8);
      ctx.stroke();
      ctx.fillStyle = '#ffd444';
      ctx.font = `9px ${mono}`;
      ctx.fillText('ZERO', woX + 10, woY - 4);
    }

    for (const seg of pathRef.current) {
      const intensity = Math.min(1, seg.power / 1000);
      ctx.strokeStyle = `rgba(255, ${Math.round(100 - intensity * 100)}, ${Math.round(50 - intensity * 50)}, ${0.3 + intensity * 0.7})`;
      ctx.lineWidth = 1 + intensity;
      ctx.beginPath();
      ctx.moveTo(ox + seg.from.x * scale, toCanvasY(seg.from.y));
      ctx.lineTo(ox + seg.to.x * scale, toCanvasY(seg.to.y));
      ctx.stroke();
    }

    const hx = ox + state.x * scale;
    const hy = toCanvasY(state.y);

    if (state.laserOn && state.laserPower > 0) {
      const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 12);
      glow.addColorStop(0, 'rgba(255, 100, 50, 0.6)');
      glow.addColorStop(1, 'rgba(255, 100, 50, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(hx - 12, hy - 12, 24, 24);
    }

    ctx.strokeStyle = state.laserOn ? '#ff4466' : '#2dd4a0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx - 6, hy);
    ctx.lineTo(hx + 6, hy);
    ctx.moveTo(hx, hy - 6);
    ctx.lineTo(hx, hy + 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.stroke();

    const wpx = state.x - state.workOffsetX;
    const wpy = state.y - state.workOffsetY;
    ctx.fillStyle = '#555570';
    ctx.font = `10px ${mono}`;
    ctx.fillText(`MPos: X${state.x.toFixed(1)} Y${state.y.toFixed(1)}`, 8, h - 28);
    ctx.fillText(`WPos: X${wpx.toFixed(1)} Y${wpy.toFixed(1)}`, 8, h - 16);
    ctx.fillText(`Laser: ${state.laserOn ? `ON S${state.laserPower}` : 'OFF'} F${state.feedRate}`, 8, h - 4);
    ctx.fillStyle = '#333355';
    ctx.fillText(`${pathRef.current.length} cut segs`, w - 80, h - 4);
  }, [bedWidth, bedHeight, originCorner]);

  drawRef.current = draw;

  const processLine = useCallback(
    (line: string) => {
      const state = stateRef.current;
      const trail = trailCursorRef.current;
      const upper = line.trim().toUpperCase();
      if (!upper || upper.startsWith(';')) return;
      if (upper === '?' || upper === '') return;

      if (upper.startsWith('$J=')) {
        const xMatch = upper.match(/X([-\d.]+)/);
        const yMatch = upper.match(/Y([-\d.]+)/);
        const isInc = upper.includes('G91');
        const bx = jobRunning ? trail.x : state.x;
        const by = jobRunning ? trail.y : state.y;
        let newX = bx;
        let newY = by;
        if (isInc) {
          if (xMatch) newX += parseFloat(xMatch[1]);
          if (yMatch) newY += parseFloat(yMatch[1]);
        } else {
          if (xMatch) newX = parseFloat(xMatch[1]) + state.workOffsetX;
          if (yMatch) newY = parseFloat(yMatch[1]) + state.workOffsetY;
        }
        trailCursorRef.current = { x: newX, y: newY };
        if (!jobRunning) {
          state.x = newX;
          state.y = newY;
        }
        drawRef.current();
        return;
      }

      if (upper.startsWith('$')) return;

      if (upper.includes('G10') && upper.includes('L20')) {
        const xMatch = upper.match(/X([-\d.]+)/);
        const yMatch = upper.match(/Y([-\d.]+)/);
        if (xMatch) state.workOffsetX = state.x - parseFloat(xMatch[1]);
        if (yMatch) state.workOffsetY = state.y - parseFloat(yMatch[1]);
        zeroRef.current = { x: state.x, y: state.y };
        drawRef.current();
        return;
      }

      if (upper.includes('G92')) {
        const xMatch = upper.match(/X([-\d.]+)/);
        const yMatch = upper.match(/Y([-\d.]+)/);
        if (xMatch) state.workOffsetX = state.x - parseFloat(xMatch[1]);
        if (yMatch) state.workOffsetY = state.y - parseFloat(yMatch[1]);
        drawRef.current();
        return;
      }

      if (!/\bG0\b|\bG00\b|\bG1\b|\bG01\b/.test(upper)) {
        if (upper.includes('G90')) state.isAbsolute = true;
        if (upper.includes('G91')) state.isAbsolute = false;
      }

      if (/M\s*3\b/.test(upper) || /M\s*4\b/.test(upper)) {
        state.laserOn = true;
        const sMatch = upper.match(/S([-\d.]+)/);
        if (sMatch) state.laserPower = parseFloat(sMatch[1]);
      }
      if (upper.includes('M5')) {
        state.laserOn = false;
        state.laserPower = 0;
      }

      const fMatch = upper.match(/F([-\d.]+)/);
      if (fMatch) state.feedRate = parseFloat(fMatch[1]);

      const isG0 = /\bG0\b/.test(upper) || /\bG00\b/.test(upper);
      const isG1 = /\bG1\b/.test(upper) || /\bG01\b/.test(upper);
      if (isG0 || isG1 || /^[XY]/.test(upper.trim())) {
        const hadG90 = upper.includes('G90');
        const hadG91 = upper.includes('G91');
        let incremental: boolean;
        if (hadG91) incremental = true;
        else if (hadG90) incremental = false;
        else incremental = !state.isAbsolute;

        const xMatch = upper.match(/X([-\d.]+)/);
        const yMatch = upper.match(/Y([-\d.]+)/);
        const inlineS = upper.match(/S([-\d.]+)/);
        if (inlineS) state.laserPower = parseFloat(inlineS[1]);

        const bx = jobRunning ? trail.x : state.x;
        const by = jobRunning ? trail.y : state.y;
        let newX = bx;
        let newY = by;
        if (incremental) {
          if (xMatch) newX += parseFloat(xMatch[1]);
          if (yMatch) newY += parseFloat(yMatch[1]);
        } else {
          if (xMatch) newX = parseFloat(xMatch[1]) + state.workOffsetX;
          if (yMatch) newY = parseFloat(yMatch[1]) + state.workOffsetY;
        }

        if (hadG91) state.isAbsolute = false;
        if (hadG90) state.isAbsolute = true;

        const isG1Move = isG1 || (!isG0 && state.laserOn);
        if (isG1Move && state.laserOn && state.laserPower > 0) {
          pathRef.current.push({
            from: { x: bx, y: by },
            to: { x: newX, y: newY },
            power: state.laserPower,
          });
        }

        trailCursorRef.current = { x: newX, y: newY };
        // Echo position: only drives head when idle. During a job, liveHead (MPos/WPos) drives the marker — see useEffect below.
        if (!jobRunning) {
          state.x = newX;
          state.y = newY;
        }
      }

      drawRef.current();
    },
    [jobRunning],
  );

  useEffect(() => {
    return onSubscribe(processLine);
  }, [onSubscribe, processLine]);

  useEffect(() => {
    if (!liveHead) return;
    const s = stateRef.current;
    s.x = liveHead.x + s.workOffsetX;
    s.y = liveHead.y + s.workOffsetY;
    drawRef.current();
  }, [liveHead]);

  /** Keep echo trail cursor aligned with machine/head when toggling job mode so the next gcode line parses from the right base. */
  useEffect(() => {
    const s = stateRef.current;
    trailCursorRef.current = { x: s.x, y: s.y };
  }, [jobRunning]);

  useEffect(() => {
    draw();
  }, [draw]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => setTick(t => t + 1));
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column' as const, height: '100%' } },
    React.createElement(
      'div',
      {
        style: {
          padding: '6px 12px',
          borderBottom: '1px solid #1a1a2e',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        },
      },
      React.createElement('span', { style: { fontSize: 10, color: '#555570', fontFamily: font } }, 'GRBL Simulator'),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            pathRef.current = [];
            zeroRef.current = null;
            stateRef.current = {
              x: 0,
              y: 0,
              laserOn: false,
              laserPower: 0,
              feedRate: 1000,
              workOffsetX: 0,
              workOffsetY: 0,
              isAbsolute: true,
            };
            trailCursorRef.current = { x: 0, y: 0 };
            drawRef.current();
          },
          style: {
            background: 'none',
            border: '1px solid #252540',
            borderRadius: 4,
            color: '#555570',
            fontSize: 9,
            cursor: 'pointer',
            padding: '2px 8px',
            fontFamily: font,
          },
        },
        'Clear',
      ),
    ),
    React.createElement('canvas', {
      ref: canvasRef,
      style: { flex: 1, width: '100%', minHeight: 200, display: 'block', cursor: 'crosshair' },
    }),
  );
}
