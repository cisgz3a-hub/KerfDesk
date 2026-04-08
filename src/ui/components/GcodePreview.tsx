import React, { useEffect, useRef } from 'react';
import { estimateJobTime } from '../../core/output/TimeEstimator';

interface GcodePreviewProps {
  gcode: string;
  bedWidth: number;
  bedHeight: number;
  onClose: () => void;
}

export function GcodePreview({ gcode, bedWidth, bedHeight, onClose }: GcodePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = 700;
    const ch = 500;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, cw, ch);

    // Scale to fit bed
    const pad = 30;
    const scale = Math.min((cw - pad * 2) / bedWidth, (ch - pad * 2) / bedHeight);
    const ox = (cw - bedWidth * scale) / 2;
    const oy = (ch - bedHeight * scale) / 2;

    // Draw bed outline
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, bedWidth * scale, bedHeight * scale);

    const estimate = estimateJobTime(gcode);

    // Parse and draw G-code
    const lines = gcode.split('\n');
    let x = 0, y = 0;
    let laserOn = false;
    let power = 0;  // 0-1000
    let moveCount = 0;
    let cutCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';')) continue;

      // Parse S value
      const sMatch = trimmed.match(/S(\d+)/);
      if (sMatch) power = parseInt(sMatch[1], 10);

      // Laser on/off
      if (trimmed.startsWith('M3') || trimmed.startsWith('M4')) laserOn = true;
      if (trimmed.startsWith('M5')) { laserOn = false; power = 0; }

      // Movement
      const xMatch = trimmed.match(/X([-\d.]+)/);
      const yMatch = trimmed.match(/Y([-\d.]+)/);

      if (xMatch || yMatch) {
        const nx = xMatch ? parseFloat(xMatch[1]) : x;
        const ny = yMatch ? parseFloat(yMatch[1]) : y;

        const sx1 = ox + x * scale;
        const sy1 = oy + y * scale;
        const sx2 = ox + nx * scale;
        const sy2 = oy + ny * scale;

        if (trimmed.startsWith('G0')) {
          // Rapid move (travel)
          ctx.strokeStyle = 'rgba(80, 80, 120, 0.15)';
          ctx.lineWidth = 0.5;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
          ctx.setLineDash([]);
          moveCount++;
        } else if (trimmed.startsWith('G1')) {
          // Linear move (cut/engrave)
          const intensity = Math.min(power / 700, 1);
          if (laserOn && power > 0) {
            const r = Math.round(255 * intensity);
            const g = Math.round(120 * (1 - intensity));
            const b = Math.round(50 * (1 - intensity));
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + intensity * 0.6})`;
            ctx.lineWidth = 1 + intensity;
          } else {
            ctx.strokeStyle = 'rgba(80, 80, 120, 0.1)';
            ctx.lineWidth = 0.5;
          }
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
          cutCount++;
        }

        x = nx;
        y = ny;
      }
    }

    // Stats overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(8, ch - 66, 220, 58);
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.fillStyle = '#8888aa';
    ctx.textBaseline = 'top';
    ctx.fillText(`Travel moves: ${moveCount}`, 14, ch - 58);
    ctx.fillText(`Cut moves: ${cutCount}`, 14, ch - 44);
    ctx.fillText(`Total distance: ${(estimate.totalDistance / 1000).toFixed(1)}m`, 14, ch - 30);
    ctx.fillStyle = '#00d4ff';
    ctx.fillText(`Estimated time: ${estimate.formatted}`, 14, ch - 16);

  }, [gcode, bedWidth, bedHeight]);

  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";

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
        background: '#0c0c16', border: '1px solid #252540', borderRadius: 12,
        overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      },
    },
      // Header
      React.createElement('div', {
        style: {
          padding: '12px 18px', borderBottom: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
      },
        React.createElement('div', null,
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'G-code Toolpath Preview'),
          React.createElement('span', { style: { color: '#555570', fontSize: 11, marginLeft: 12 } },
            `${(gcode.length / 1024).toFixed(1)} KB`
          ),
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
        }, '×'),
      ),

      // Canvas
      React.createElement('div', { style: { padding: 8 } },
        React.createElement('canvas', {
          ref: canvasRef,
          style: { borderRadius: 8, display: 'block' },
        }),
      ),

      // Legend
      React.createElement('div', {
        style: {
          padding: '8px 18px 14px',
          display: 'flex', gap: 20, borderTop: '1px solid #1a1a2e',
        },
      },
        React.createElement('span', { style: { fontSize: 10, color: '#555570', display: 'flex', alignItems: 'center', gap: 4 } },
          React.createElement('span', { style: { width: 16, height: 2, background: 'rgba(80, 80, 120, 0.4)', display: 'inline-block', borderTop: '1px dashed #505078' } }),
          'Travel'
        ),
        React.createElement('span', { style: { fontSize: 10, color: '#555570', display: 'flex', alignItems: 'center', gap: 4 } },
          React.createElement('span', { style: { width: 16, height: 2, background: '#ff4422', display: 'inline-block' } }),
          'High power'
        ),
        React.createElement('span', { style: { fontSize: 10, color: '#555570', display: 'flex', alignItems: 'center', gap: 4 } },
          React.createElement('span', { style: { width: 16, height: 2, background: '#ff8844', display: 'inline-block' } }),
          'Low power'
        ),
      ),
    ),
  );
}
