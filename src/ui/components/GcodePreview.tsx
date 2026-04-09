import React, { useEffect, useMemo, useRef, useState } from 'react';
import { estimateJobTime } from '../../core/output/TimeEstimator';

interface GcodePreviewProps {
  gcode: string;
  bedWidth: number;
  bedHeight: number;
  onClose: () => void;
}

type ParsedMove = { x: number; y: number; type: 'rapid' | 'cut'; time: number };

export function GcodePreview({ gcode, bedWidth, bedHeight, onClose }: GcodePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [playSpeed, setPlaySpeed] = useState(1);
  const playProgressRef = useRef(0);

  useEffect(() => {
    playProgressRef.current = playProgress;
  }, [playProgress]);

  const parsedMoves = useMemo(() => {
    if (!gcode) return [];
    const moves: ParsedMove[] = [];
    let x = 0;
    let y = 0;
    let feedRate = 1000;
    let totalTime = 0;

    for (const line of gcode.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';')) continue;

      const upper = trimmed.toUpperCase();
      const fMatch = trimmed.match(/F([\d.]+)/i);
      if (fMatch) feedRate = parseFloat(fMatch[1]);

      const xMatch = trimmed.match(/X([-\d.]+)/i);
      const yMatch = trimmed.match(/Y([-\d.]+)/i);

      if (xMatch || yMatch) {
        const nx = xMatch ? parseFloat(xMatch[1]) : x;
        const ny = yMatch ? parseFloat(yMatch[1]) : y;
        const dist = Math.sqrt((nx - x) ** 2 + (ny - y) ** 2);
        const isRapid = upper.startsWith('G0');
        const speed = isRapid ? 5000 : feedRate;
        const moveTime = speed > 0 ? (dist / speed) * 60 : 0;
        totalTime += moveTime;

        moves.push({ x: nx, y: ny, type: isRapid ? 'rapid' : 'cut', time: totalTime });
        x = nx;
        y = ny;
      }
    }
    return moves;
  }, [gcode]);

  const totalDuration = parsedMoves.length > 0 ? parsedMoves[parsedMoves.length - 1].time : 0;

  useEffect(() => {
    if (!isPlaying || parsedMoves.length === 0 || totalDuration <= 0) return;

    const startWall = performance.now() - (playProgressRef.current * totalDuration * 1000) / playSpeed;
    let id = 0;

    const step = () => {
      const elapsed = ((performance.now() - startWall) * playSpeed) / 1000;
      const p = Math.min(1, elapsed / totalDuration);
      setPlayProgress(p);
      if (p < 1) {
        id = requestAnimationFrame(step);
      } else {
        setIsPlaying(false);
      }
    };

    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [isPlaying, playSpeed, totalDuration, parsedMoves.length]);

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

    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, cw, ch);

    const pad = 30;
    const scale = Math.min((cw - pad * 2) / bedWidth, (ch - pad * 2) / bedHeight);
    const ox = (cw - bedWidth * scale) / 2;
    const oy = (ch - bedHeight * scale) / 2;

    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, bedWidth * scale, bedHeight * scale);

    const estimate = estimateJobTime(gcode);
    const animating = isPlaying || playProgress > 0;
    const currentTime = playProgress * totalDuration;

    const lines = gcode.split('\n');
    let moveCount = 0;
    let cutCount = 0;

    const runDrawPass = (faint: boolean) => {
      let lx = 0;
      let ly = 0;
      let lOn = false;
      let pwr = 0;
      ctx.globalAlpha = faint ? 0.22 : 1;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';')) continue;

        const sMatch = trimmed.match(/S(\d+)/i);
        if (sMatch) pwr = parseInt(sMatch[1], 10);

        const up = trimmed.toUpperCase();
        if (up.startsWith('M3') || up.startsWith('M4')) lOn = true;
        if (up.startsWith('M5')) {
          lOn = false;
          pwr = 0;
        }

        const xMatch = trimmed.match(/X([-\d.]+)/i);
        const yMatch = trimmed.match(/Y([-\d.]+)/i);

        if (xMatch || yMatch) {
          const nx = xMatch ? parseFloat(xMatch[1]) : lx;
          const ny = yMatch ? parseFloat(yMatch[1]) : ly;

          const px1 = ox + lx * scale;
          const py1 = oy + ly * scale;
          const px2 = ox + nx * scale;
          const py2 = oy + ny * scale;

          if (up.startsWith('G0')) {
            ctx.strokeStyle = 'rgba(80, 80, 120, 0.5)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(px1, py1);
            ctx.lineTo(px2, py2);
            ctx.stroke();
            ctx.setLineDash([]);
            moveCount++;
          } else if (up.startsWith('G1')) {
            const intensity = Math.min(pwr / 700, 1);
            if (lOn && pwr > 0) {
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
            ctx.moveTo(px1, py1);
            ctx.lineTo(px2, py2);
            ctx.stroke();
            cutCount++;
          }

          lx = nx;
          ly = ny;
        }
      }
      ctx.globalAlpha = 1;
    };

    if (animating && totalDuration > 0) {
      runDrawPass(true);
    } else {
      runDrawPass(false);
    }

    if (animating && parsedMoves.length > 0 && totalDuration > 0) {
      ctx.beginPath();
      let started = false;
      for (const move of parsedMoves) {
        if (move.time > currentTime) break;
        const sx = ox + move.x * scale;
        const sy = oy + move.y * scale;
        if (!started) {
          ctx.moveTo(sx, sy);
          started = true;
        } else {
          ctx.lineTo(sx, sy);
        }
      }
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.stroke();

      const lastVisible = parsedMoves.filter(m => m.time <= currentTime).pop();
      if (lastVisible) {
        const hx = ox + lastVisible.x * scale;
        const hy = oy + lastVisible.y * scale;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4466';
        ctx.fill();
      }
    }

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
  }, [gcode, bedWidth, bedHeight, playProgress, totalDuration, parsedMoves, isPlaying]);

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

      React.createElement('div', { style: { padding: 8 } },
        React.createElement('canvas', {
          ref: canvasRef,
          style: { borderRadius: 8, display: 'block' },
        }),
      ),

      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px' },
      },
        React.createElement('button', {
          onClick: () => {
            if (playProgress >= 1) {
              setPlayProgress(0);
              playProgressRef.current = 0;
            }
            setIsPlaying(p => !p);
          },
          style: {
            padding: '4px 14px', background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff',
            borderRadius: 6, color: '#00d4ff', fontSize: 12, cursor: 'pointer', fontFamily: font,
          },
        }, isPlaying ? '⏸ Pause' : '▶ Play'),

        ...[1, 2, 5, 10].map(s =>
          React.createElement('button', {
            key: s,
            onClick: () => setPlaySpeed(s),
            style: {
              padding: '3px 8px', fontSize: 10, cursor: 'pointer',
              background: playSpeed === s ? 'rgba(0,212,255,0.1)' : 'transparent',
              border: playSpeed === s ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 4, color: playSpeed === s ? '#00d4ff' : '#555570',
              fontFamily: "'JetBrains Mono', monospace",
            },
          }, `${s}x`),
        ),

        React.createElement('input', {
          type: 'range', min: 0, max: 100, value: Math.round(playProgress * 100),
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setPlayProgress(parseInt(e.target.value, 10) / 100);
            setIsPlaying(false);
          },
          style: { flex: 1 },
        }),

        React.createElement('span', {
          style: { fontSize: 10, color: '#555570', fontFamily: "'JetBrains Mono', monospace", minWidth: 40 },
        }, `${Math.round(playProgress * 100)}%`),
      ),

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
