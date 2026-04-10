import React, { useState, useEffect, useRef, useCallback } from 'react';

interface SimulatorViewProps {
  onSubscribe: (callback: (line: string) => void) => () => void;
  bedWidth: number;
  bedHeight: number;
  /** GRBL work position when idle (e.g. after jog); ignored while jobRunning */
  liveHead: { x: number; y: number } | null;
  jobRunning: boolean;
}

interface MachineState {
  x: number;
  y: number;
  laserOn: boolean;
  laserPower: number;
  feedRate: number;
}

export function SimulatorView({
  onSubscribe,
  bedWidth,
  bedHeight,
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
  });
  const pathRef = useRef<Array<{ from: { x: number; y: number }; to: { x: number; y: number }; power: number }>>([]);
  const zeroRef = useRef<{ x: number; y: number } | null>(null);
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
      const woY = oy + zm.y * scale;
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
      ctx.moveTo(ox + seg.from.x * scale, oy + seg.from.y * scale);
      ctx.lineTo(ox + seg.to.x * scale, oy + seg.to.y * scale);
      ctx.stroke();
    }

    const hx = ox + state.x * scale;
    const hy = oy + state.y * scale;

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

    ctx.fillStyle = '#555570';
    ctx.font = `10px ${mono}`;
    ctx.fillText(`WPos: X${state.x.toFixed(1)} Y${state.y.toFixed(1)}`, 8, h - 16);
    ctx.fillText(`Laser: ${state.laserOn ? `ON S${state.laserPower}` : 'OFF'} F${state.feedRate}`, 8, h - 4);
    ctx.fillStyle = '#333355';
    ctx.fillText(`${pathRef.current.length} cut segs`, w - 80, h - 4);
  }, [bedWidth, bedHeight]);

  drawRef.current = draw;

  const processLine = useCallback(
    (line: string) => {
      const state = stateRef.current;
      const upper = line.trim().toUpperCase();
      if (!upper || upper.startsWith(';')) return;
      if (upper.startsWith('$') && !upper.startsWith('$J')) return;
      if (upper === '?' || upper === '') return;

      if (upper.includes('G10') && upper.includes('L20')) {
        zeroRef.current = { x: state.x, y: state.y };
        state.x = 0;
        state.y = 0;
        drawRef.current();
        return;
      }

      if (upper.includes('G92')) {
        const xMatch = upper.match(/X([-\d.]+)/);
        const yMatch = upper.match(/Y([-\d.]+)/);
        if (xMatch) state.x = parseFloat(xMatch[1]);
        if (yMatch) state.y = parseFloat(yMatch[1]);
        drawRef.current();
        return;
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
        const xMatch = upper.match(/X([-\d.]+)/);
        const yMatch = upper.match(/Y([-\d.]+)/);
        const inlineS = upper.match(/S([-\d.]+)/);
        if (inlineS) state.laserPower = parseFloat(inlineS[1]);

        const newX = xMatch ? parseFloat(xMatch[1]) : state.x;
        const newY = yMatch ? parseFloat(yMatch[1]) : state.y;

        if (isG1 && state.laserOn && state.laserPower > 0) {
          pathRef.current.push({
            from: { x: state.x, y: state.y },
            to: { x: newX, y: newY },
            power: state.laserPower,
          });
        }

        state.x = newX;
        state.y = newY;
      }

      drawRef.current();
    },
    [],
  );

  useEffect(() => {
    return onSubscribe(processLine);
  }, [onSubscribe, processLine]);

  useEffect(() => {
    if (jobRunning || !liveHead) return;
    stateRef.current.x = liveHead.x;
    stateRef.current.y = liveHead.y;
    drawRef.current();
  }, [liveHead?.x, liveHead?.y, jobRunning]);

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
            };
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
