import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildGcodePreviewModel } from './gcodePreviewModel';

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

  const previewModel = useMemo(() => buildGcodePreviewModel(gcode), [gcode]);
  const parsedMoves = previewModel.moves;
  const totalDuration = previewModel.totalDuration;
  const bounds = previewModel.bounds;

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
    const completedMoves = Math.min(
      previewModel.totalMoveCount,
      Math.round(progress * previewModel.totalMoveCount),
    );
    const overlayHeight = previewModel.isSampled ? 82 : 64;
    const overlayY = ch - overlayHeight - 8;
    ctx.fillStyle = 'rgba(8, 8, 15, 0.85)';
    ctx.fillRect(8, overlayY, 260, overlayHeight);
    ctx.font = '11px JetBrains Mono, monospace';

    ctx.fillStyle = 'rgba(100, 100, 130, 0.6)';
    ctx.fillText(`Travel: ${previewModel.travelCount}  Cut: ${previewModel.cutCount}`, 14, overlayY + 16);

    ctx.fillStyle = '#8888aa';
    ctx.fillText(`Progress: ${completedMoves}/${previewModel.totalMoveCount} moves`, 14, overlayY + 32);

    const elapsed = currentTime;
    const mins = Math.floor(elapsed / 60);
    const secs = Math.round(elapsed % 60);
    ctx.fillStyle = '#00d4ff';
    ctx.fillText(`Time: ${mins}m ${secs}s / ${Math.floor(totalDuration / 60)}m ${Math.round(totalDuration % 60)}s`, 14, overlayY + 48);

    if (previewModel.isSampled) {
      ctx.fillStyle = '#ffaa33';
      ctx.fillText(`Sampled preview: ${parsedMoves.length}/${previewModel.totalMoveCount} moves`, 14, overlayY + 66);
    }
  }, [parsedMoves, bounds, totalDuration, previewModel]);

  // Canvas size + DPR (logical coords for renderFrame)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const logicalW = 650;
    const logicalH = 400;
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = '100%';
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
  }, [isPlaying, playProgress, playSpeed, renderFrame, totalDuration, parsedMoves.length]);

  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";

  return React.createElement('div', {
    // Outer modal container
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 2000,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      // Inner dialog
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 700, maxHeight: '90vh',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column' as const,
        overflow: 'hidden',
        fontFamily: font,
      },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); },
    },
      // Header — always visible
      React.createElement('div', {
        style: {
          padding: '12px 18px', borderBottom: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        },
      },
        React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Toolpath Preview'),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 20, cursor: 'pointer', padding: '0 4px' },
        }, '×'),
      ),

      React.createElement('div', {
        style: {
          flex: 1,
          minHeight: 0,
          overflowY: 'auto' as const,
        },
      },
        // Canvas container
        React.createElement('div', {
          style: { padding: '12px 18px', flexShrink: 0 },
        },
          React.createElement('canvas', {
            ref: canvasRef,
            width: 650,
            height: 400,
            style: { width: '100%', height: 400, background: '#08080f', borderRadius: 8, display: 'block' },
          }),
        ),
      ),

      // Playback controls — always visible
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px', borderTop: '1px solid #1a1a2e', flexShrink: 0 },
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
          padding: '8px 18px 10px',
          display: 'flex', gap: 20, borderTop: '1px solid #1a1a2e',
          flexShrink: 0,
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

      // Bottom close — always reachable
      React.createElement('div', {
        style: { padding: '8px 18px 12px', borderTop: '1px solid #1a1a2e', flexShrink: 0 },
      },
        React.createElement('button', {
          onClick: onClose,
          style: {
            width: '100%', padding: '8px',
            background: 'rgba(136,136,170,0.08)',
            border: '1px solid #252540',
            borderRadius: 6, color: '#8888aa',
            fontSize: 12, cursor: 'pointer',
            fontFamily: "'DM Sans', system-ui, sans-serif",
          },
        }, 'Close'),
      ),
    ),
  );
}
