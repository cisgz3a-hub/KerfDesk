import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface GcodePreviewProps {
  gcode: string;
  bedWidth: number;
  bedHeight: number;
  onClose: () => void;
}

export function GcodePreview({ gcode, bedWidth, bedHeight, onClose }: GcodePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [playSpeed, setPlaySpeed] = useState(1);

  // Parse all moves once
  const parsedMoves = useMemo(() => {
    if (!gcode) return [];
    const moves: Array<{ fromX: number; fromY: number; toX: number; toY: number; type: 'rapid' | 'cut'; time: number }> = [];
    let x = 0;
    let y = 0;
    let feedRate = 1000;
    let totalTime = 0;
    let modalRapid = true;

    for (const line of gcode.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';')) continue;

      const gMatch = trimmed.match(/^G\s*(\d+)/i);
      if (gMatch) {
        const gNum = parseInt(gMatch[1], 10);
        modalRapid = gNum === 0;
      }

      const fMatch = trimmed.match(/F([\d.]+)/);
      if (fMatch) feedRate = parseFloat(fMatch[1]);

      const xMatch = trimmed.match(/X([-\d.]+)/);
      const yMatch = trimmed.match(/Y([-\d.]+)/);

      if (xMatch || yMatch) {
        const nx = xMatch ? parseFloat(xMatch[1]) : x;
        const ny = yMatch ? parseFloat(yMatch[1]) : y;
        const dist = Math.sqrt((nx - x) ** 2 + (ny - y) ** 2);
        const isRapid = modalRapid;
        const speed = isRapid ? 5000 : (feedRate || 1000);
        const moveTime = dist > 0 ? (dist / speed) * 60 : 0;
        totalTime += moveTime;

        moves.push({ fromX: x, fromY: y, toX: nx, toY: ny, type: isRapid ? 'rapid' : 'cut', time: totalTime });
        x = nx;
        y = ny;
      }
    }
    return moves;
  }, [gcode]);

  const totalDuration = parsedMoves.length > 0 ? parsedMoves[parsedMoves.length - 1].time : 0;

  // Compute bounds from all moves
  const bounds = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of parsedMoves) {
      minX = Math.min(minX, m.fromX, m.toX);
      minY = Math.min(minY, m.fromY, m.toY);
      maxX = Math.max(maxX, m.fromX, m.toX);
      maxY = Math.max(maxY, m.fromY, m.toY);
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    return { minX, minY, maxX, maxY };
  }, [parsedMoves]);

  const renderFrame = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const padding = 30;

    // Clear
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, cw, ch);

    if (parsedMoves.length === 0) return;

    // Scale to fit
    const rangeX = (bounds.maxX - bounds.minX) || 1;
    const rangeY = (bounds.maxY - bounds.minY) || 1;
    const scale = Math.min((cw - padding * 2) / rangeX, (ch - padding * 2) / rangeY);
    const offsetX = (cw - rangeX * scale) / 2;
    const offsetY = (ch - rangeY * scale) / 2;

    const toScreenX = (x: number) => (x - bounds.minX) * scale + offsetX;
    const toScreenY = (y: number) => (y - bounds.minY) * scale + offsetY;

    const currentTime = progress * totalDuration;

    // Pass 1: Draw all moves as very faint background (full path preview)
    if (progress < 1) {
      ctx.globalAlpha = 0.1;
      for (const move of parsedMoves) {
        ctx.beginPath();
        ctx.moveTo(toScreenX(move.fromX), toScreenY(move.fromY));
        ctx.lineTo(toScreenX(move.toX), toScreenY(move.toY));
        ctx.strokeStyle = move.type === 'cut' ? '#ff4466' : '#444466';
        ctx.lineWidth = move.type === 'cut' ? 1 : 0.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Pass 2: Draw completed travel moves (gray dashed)
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(100, 100, 130, 0.4)';
    ctx.lineWidth = 0.5;
    for (const move of parsedMoves) {
      if (move.time > currentTime) break;
      if (move.type !== 'rapid') continue;
      ctx.beginPath();
      ctx.moveTo(toScreenX(move.fromX), toScreenY(move.fromY));
      ctx.lineTo(toScreenX(move.toX), toScreenY(move.toY));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Pass 3: Draw completed cut moves (bright red)
    ctx.strokeStyle = '#ff4466';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let needsMove = true;
    for (let i = 0; i < parsedMoves.length; i++) {
      const move = parsedMoves[i];
      if (move.time > currentTime) {
        // Partial move — interpolate position
        if (move.type === 'cut') {
          const prevTime = i > 0 ? parsedMoves[i - 1].time : 0;
          const moveDuration = move.time - prevTime;
          if (moveDuration > 0) {
            const t = (currentTime - prevTime) / moveDuration;
            const partialX = move.fromX + (move.toX - move.fromX) * t;
            const partialY = move.fromY + (move.toY - move.fromY) * t;
            if (needsMove) {
              ctx.moveTo(toScreenX(move.fromX), toScreenY(move.fromY));
              needsMove = false;
            }
            ctx.lineTo(toScreenX(partialX), toScreenY(partialY));
          }
        }
        break;
      }
      if (move.type === 'cut') {
        if (needsMove) {
          ctx.moveTo(toScreenX(move.fromX), toScreenY(move.fromY));
          needsMove = false;
        }
        ctx.lineTo(toScreenX(move.toX), toScreenY(move.toY));
      } else {
        needsMove = true;
      }
    }
    ctx.stroke();

    // Pass 4: Draw laser head position (glowing dot)
    let headX = 0;
    let headY = 0;
    let headIsCutting = false;
    for (let i = 0; i < parsedMoves.length; i++) {
      const move = parsedMoves[i];
      if (move.time > currentTime) {
        const prevTime = i > 0 ? parsedMoves[i - 1].time : 0;
        const moveDuration = move.time - prevTime;
        if (moveDuration > 0) {
          const t = (currentTime - prevTime) / moveDuration;
          headX = move.fromX + (move.toX - move.fromX) * t;
          headY = move.fromY + (move.toY - move.fromY) * t;
          headIsCutting = move.type === 'cut';
        }
        break;
      }
      headX = move.toX;
      headY = move.toY;
      headIsCutting = move.type === 'cut';
    }

    if (progress > 0 && progress < 1) {
      const sx = toScreenX(headX);
      const sy = toScreenY(headY);

      // Glow
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fillStyle = headIsCutting ? 'rgba(255, 68, 102, 0.2)' : 'rgba(0, 212, 255, 0.2)';
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = headIsCutting ? '#ff4466' : '#00d4ff';
      ctx.fill();
    }

    // Stats overlay
    const travelCount = parsedMoves.filter(m => m.type === 'rapid').length;
    const cutCount = parsedMoves.filter(m => m.type === 'cut').length;
    const completedMoves = parsedMoves.filter(m => m.time <= currentTime).length;

    ctx.fillStyle = 'rgba(8, 8, 15, 0.85)';
    ctx.fillRect(8, ch - 72, 220, 64);
    ctx.font = '11px JetBrains Mono, monospace';

    ctx.fillStyle = 'rgba(100, 100, 130, 0.6)';
    ctx.fillText(`Travel: ${travelCount}  Cut: ${cutCount}`, 14, ch - 56);

    ctx.fillStyle = '#8888aa';
    ctx.fillText(`Progress: ${completedMoves}/${parsedMoves.length} moves`, 14, ch - 40);

    const elapsed = currentTime;
    const mins = Math.floor(elapsed / 60);
    const secs = Math.round(elapsed % 60);
    ctx.fillStyle = '#00d4ff';
    ctx.fillText(`Time: ${mins}m ${secs}s / ${Math.floor(totalDuration / 60)}m ${Math.round(totalDuration % 60)}s`, 14, ch - 24);
  }, [parsedMoves, bounds, totalDuration]);

  // Canvas size + DPR (logical coords for renderFrame)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const logicalW = 700;
    const logicalH = 500;
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  // Static render when not playing
  useEffect(() => {
    if (!isPlaying) {
      renderFrame(playProgress);
    }
  }, [renderFrame, playProgress, isPlaying]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || parsedMoves.length === 0 || totalDuration === 0) return;

    const startTime = performance.now() - (playProgress * totalDuration * 1000) / playSpeed;

    const animate = () => {
      const elapsed = ((performance.now() - startTime) * playSpeed) / 1000;
      const progress = Math.min(elapsed / totalDuration, 1);
      setPlayProgress(progress);
      renderFrame(progress);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setIsPlaying(false);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, playSpeed, renderFrame, totalDuration, parsedMoves.length]);

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

      // Playback controls
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderTop: '1px solid #1a1a2e' },
      },
        React.createElement('button', {
          onClick: () => {
            if (playProgress >= 1) setPlayProgress(0);
            setIsPlaying(!isPlaying);
          },
          style: { padding: '4px 14px', background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', borderRadius: 6, color: '#00d4ff', fontSize: 12, cursor: 'pointer', fontFamily: font, flexShrink: 0 },
        }, isPlaying ? '⏸ Pause' : '▶ Play'),

        ...[1, 2, 5, 10].map(s =>
          React.createElement('button', {
            key: s,
            onClick: () => setPlaySpeed(s),
            style: {
              padding: '2px 6px', fontSize: 9, cursor: 'pointer', flexShrink: 0,
              background: playSpeed === s ? 'rgba(0,212,255,0.1)' : 'transparent',
              border: playSpeed === s ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 4, color: playSpeed === s ? '#00d4ff' : '#555570',
              fontFamily: "'JetBrains Mono', monospace",
            },
          }, `${s}x`),
        ),

        React.createElement('input', {
          type: 'range', min: 0, max: 1000,
          value: Math.round(playProgress * 1000),
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            const p = parseInt(e.target.value, 10) / 1000;
            setPlayProgress(p);
            setIsPlaying(false);
            renderFrame(p);
          },
          style: { flex: 1, accentColor: '#00d4ff' },
        }),

        React.createElement('span', {
          style: { fontSize: 10, color: '#555570', fontFamily: "'JetBrains Mono', monospace", minWidth: 36, textAlign: 'right' as const, flexShrink: 0 },
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
