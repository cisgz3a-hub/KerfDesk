import React, { useState, useCallback, useRef, useEffect } from 'react';

export interface GridArrayConfig {
  cols: number;
  rows: number;
  spacingX: number;
  spacingY: number;
}

interface GridArrayDialogProps {
  /** Bounding box of the source objects in world coords */
  sourceWidth: number;
  sourceHeight: number;
  onConfirm: (config: GridArrayConfig) => void;
  onCancel: () => void;
}

export function GridArrayDialog({ sourceWidth, sourceHeight, onConfirm, onCancel }: GridArrayDialogProps) {
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(2);
  const [spacingX, setSpacingX] = useState(5);
  const [spacingY, setSpacingY] = useState(5);
  const [lockSpacing, setLockSpacing] = useState(true);
  const [numDrafts, setNumDrafts] = useState<Record<string, string>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const numDisplay = (key: string, canonical: number) =>
    Object.prototype.hasOwnProperty.call(numDrafts, key) ? numDrafts[key]! : String(canonical);

  // Update linked spacing
  const handleSpacingX = useCallback((val: number) => {
    setSpacingX(val);
    if (lockSpacing) setSpacingY(val);
  }, [lockSpacing]);

  const handleSpacingY = useCallback((val: number) => {
    setSpacingY(val);
    if (lockSpacing) setSpacingX(val);
  }, [lockSpacing]);

  // Hover cell tracking
  const [hoverCell, setHoverCell] = useState<{ col: number; row: number } | null>(null);

  // Draw preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    const cw = 320;
    const ch = 200;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, cw, ch);

    // Compute total grid size
    const totalW = cols * sourceWidth + (cols - 1) * spacingX;
    const totalH = rows * sourceHeight + (rows - 1) * spacingY;

    // Scale to fit preview with padding
    const pad = 20;
    const scale = Math.min((cw - pad * 2) / totalW, (ch - pad * 2) / totalH, 1);
    const ox = (cw - totalW * scale) / 2;
    const oy = (ch - totalH * scale) / 2;

    const stepX = (sourceWidth + spacingX) * scale;
    const stepY = (sourceHeight + spacingY) * scale;
    const itemW = sourceWidth * scale;
    const itemH = sourceHeight * scale;

    // Draw grid cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * stepX;
        const y = oy + r * stepY;

        const isOriginal = r === 0 && c === 0;
        const isHovered = hoverCell && hoverCell.col === c && hoverCell.row === r;

        if (isOriginal) {
          ctx.fillStyle = 'rgba(0, 212, 255, 0.25)';
          ctx.strokeStyle = '#00d4ff';
          ctx.lineWidth = 2;
        } else if (isHovered) {
          ctx.fillStyle = 'rgba(0, 212, 255, 0.15)';
          ctx.strokeStyle = 'rgba(0, 212, 255, 0.6)';
          ctx.lineWidth = 1.5;
        } else {
          ctx.fillStyle = 'rgba(0, 212, 255, 0.06)';
          ctx.strokeStyle = 'rgba(0, 212, 255, 0.25)';
          ctx.lineWidth = 1;
        }

        // Rounded rect
        const radius = 3;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + itemW - radius, y);
        ctx.quadraticCurveTo(x + itemW, y, x + itemW, y + radius);
        ctx.lineTo(x + itemW, y + itemH - radius);
        ctx.quadraticCurveTo(x + itemW, y + itemH, x + itemW - radius, y + itemH);
        ctx.lineTo(x + radius, y + itemH);
        ctx.quadraticCurveTo(x, y + itemH, x, y + itemH - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw a mini icon inside each cell to represent the object
        if (itemW > 12 && itemH > 12) {
          ctx.strokeStyle = isOriginal ? 'rgba(0, 212, 255, 0.6)' : 'rgba(0, 212, 255, 0.2)';
          ctx.lineWidth = 1;
          const icx = x + itemW / 2;
          const icy = y + itemH / 2;
          const is = Math.min(itemW, itemH) * 0.3;
          // Star shape
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
            const px = icx + is * Math.cos(a);
            const py = icy + is * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            const ia = a + Math.PI / 5;
            const ipx = icx + is * 0.4 * Math.cos(ia);
            const ipy = icy + is * 0.4 * Math.sin(ia);
            ctx.lineTo(ipx, ipy);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }

    // Dimension labels
    if (cols > 1 && spacingX > 0) {
      const labelY = oy - 8;
      const x1 = ox + itemW;
      const x2 = ox + stepX;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, labelY);
      ctx.lineTo(x2, labelY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${spacingX}mm`, (x1 + x2) / 2, labelY - 2);
    }

    // Count label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${cols * rows} total copies`, cw / 2, ch - 6);

  }, [cols, rows, spacingX, spacingY, sourceWidth, sourceHeight, hoverCell]);

  // Handle canvas hover for cell highlighting
  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const cw = 320;
    const ch = 200;
    const totalW = cols * sourceWidth + (cols - 1) * spacingX;
    const totalH = rows * sourceHeight + (rows - 1) * spacingY;
    const scale = Math.min((cw - 40) / totalW, (ch - 40) / totalH, 1);
    const ox = (cw - totalW * scale) / 2;
    const oy = (ch - totalH * scale) / 2;
    const stepX = (sourceWidth + spacingX) * scale;
    const stepY = (sourceHeight + spacingY) * scale;
    const itemW = sourceWidth * scale;
    const itemH = sourceHeight * scale;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * stepX;
        const y = oy + r * stepY;
        if (mx >= x && mx <= x + itemW && my >= y && my <= y + itemH) {
          setHoverCell({ col: c, row: r });
          return;
        }
      }
    }
    setHoverCell(null);
  }, [cols, rows, spacingX, spacingY, sourceWidth, sourceHeight]);

  // Quick grid presets
  const presets = [
    { label: '2×1', cols: 2, rows: 1 },
    { label: '2×2', cols: 2, rows: 2 },
    { label: '3×2', cols: 3, rows: 2 },
    { label: '3×3', cols: 3, rows: 3 },
    { label: '4×3', cols: 4, rows: 3 },
    { label: '5×4', cols: 5, rows: 4 },
  ];

  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
  const mono = "'JetBrains Mono', 'Consolas', monospace";

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000,
      fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onCancel(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e',
        border: '1px solid #252540',
        borderRadius: 12,
        padding: 0,
        width: 380,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: {
          padding: '14px 18px',
          borderBottom: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
      },
        React.createElement('span', {
          style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 },
        }, 'Grid Array'),
        React.createElement('button', {
          onClick: onCancel,
          style: {
            background: 'none', border: 'none', color: '#555570',
            fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          },
        }, '×'),
      ),

      // Preview canvas
      React.createElement('div', {
        style: { padding: '12px 18px 8px', borderBottom: '1px solid #1a1a2e' },
      },
        React.createElement('canvas', {
          ref: canvasRef,
          onMouseMove: handleCanvasMove,
          onMouseLeave: () => setHoverCell(null),
          style: { width: '100%', height: 200, borderRadius: 8, cursor: 'crosshair' },
        }),
      ),

      // Quick presets
      React.createElement('div', {
        style: {
          display: 'flex', gap: 4, padding: '10px 18px 6px',
          flexWrap: 'wrap' as const,
        },
      },
        ...presets.map(p =>
          React.createElement('button', {
            key: p.label,
            onClick: () => { setCols(p.cols); setRows(p.rows); },
            style: {
              padding: '4px 10px',
              background: (cols === p.cols && rows === p.rows) ? 'rgba(0, 212, 255, 0.15)' : 'rgba(255,255,255,0.04)',
              border: (cols === p.cols && rows === p.rows) ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 4,
              color: (cols === p.cols && rows === p.rows) ? '#00d4ff' : '#8888aa',
              fontSize: 11,
              fontFamily: mono,
              cursor: 'pointer',
              transition: 'all 0.1s ease',
            },
          }, p.label),
        ),
      ),

      // Controls
      React.createElement('div', {
        style: { padding: '8px 18px 16px', display: 'flex', flexDirection: 'column' as const, gap: 10 },
      },
        // Columns and Rows
        React.createElement('div', { style: { display: 'flex', gap: 12 } },
          // Columns
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('label', { style: { fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 4 } }, 'Columns'),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              React.createElement('button', {
                onClick: () => {
                  setNumDrafts(d => {
                    const n = { ...d };
                    delete n.cols;
                    return n;
                  });
                  setCols(Math.max(1, cols - 1));
                },
                style: { width: 28, height: 28, background: '#1a1a2e', border: '1px solid #252540', borderRadius: 4, color: '#8888aa', cursor: 'pointer', fontSize: 14 },
              }, '−'),
              React.createElement('input', {
                type: 'text',
                inputMode: 'numeric',
                value: numDisplay('cols', cols),
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNumDrafts(d => ({ ...d, cols: e.target.value })),
                onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                  setNumDrafts(d => {
                    const n = { ...d };
                    delete n.cols;
                    return n;
                  });
                  let val = parseInt(e.target.value, 10);
                  if (!Number.isFinite(val)) val = cols;
                  setCols(Math.max(1, Math.min(20, Math.trunc(val))));
                },
                style: {
                  width: 44, textAlign: 'center' as const, padding: '4px 0',
                  background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
                  color: '#e0e0ec', fontSize: 13, fontFamily: mono, outline: 'none',
                },
              }),
              React.createElement('button', {
                onClick: () => {
                  setNumDrafts(d => {
                    const n = { ...d };
                    delete n.cols;
                    return n;
                  });
                  setCols(Math.min(20, cols + 1));
                },
                style: { width: 28, height: 28, background: '#1a1a2e', border: '1px solid #252540', borderRadius: 4, color: '#8888aa', cursor: 'pointer', fontSize: 14 },
              }, '+'),
            ),
          ),
          // Rows
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('label', { style: { fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 4 } }, 'Rows'),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              React.createElement('button', {
                onClick: () => {
                  setNumDrafts(d => {
                    const n = { ...d };
                    delete n.rows;
                    return n;
                  });
                  setRows(Math.max(1, rows - 1));
                },
                style: { width: 28, height: 28, background: '#1a1a2e', border: '1px solid #252540', borderRadius: 4, color: '#8888aa', cursor: 'pointer', fontSize: 14 },
              }, '−'),
              React.createElement('input', {
                type: 'text',
                inputMode: 'numeric',
                value: numDisplay('rows', rows),
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNumDrafts(d => ({ ...d, rows: e.target.value })),
                onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                  setNumDrafts(d => {
                    const n = { ...d };
                    delete n.rows;
                    return n;
                  });
                  let val = parseInt(e.target.value, 10);
                  if (!Number.isFinite(val)) val = rows;
                  setRows(Math.max(1, Math.min(20, Math.trunc(val))));
                },
                style: {
                  width: 44, textAlign: 'center' as const, padding: '4px 0',
                  background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
                  color: '#e0e0ec', fontSize: 13, fontFamily: mono, outline: 'none',
                },
              }),
              React.createElement('button', {
                onClick: () => {
                  setNumDrafts(d => {
                    const n = { ...d };
                    delete n.rows;
                    return n;
                  });
                  setRows(Math.min(20, rows + 1));
                },
                style: { width: 28, height: 28, background: '#1a1a2e', border: '1px solid #252540', borderRadius: 4, color: '#8888aa', cursor: 'pointer', fontSize: 14 },
              }, '+'),
            ),
          ),
        ),

        // Spacing
        React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-end' } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('label', { style: { fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 4 } }, 'Spacing X (mm)'),
            React.createElement('input', {
              type: 'text',
              inputMode: 'decimal',
              value: numDisplay('spacingX', spacingX),
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNumDrafts(d => ({ ...d, spacingX: e.target.value })),
              onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                setNumDrafts(d => {
                  const n = { ...d };
                  delete n.spacingX;
                  return n;
                });
                let val = parseFloat(e.target.value);
                if (!Number.isFinite(val)) val = spacingX;
                handleSpacingX(Math.max(0, Math.min(100, val)));
              },
              style: {
                width: '100%', padding: '5px 8px',
                background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
                color: '#e0e0ec', fontSize: 12, fontFamily: mono, outline: 'none',
              },
            }),
          ),
          React.createElement('button', {
            onClick: () => setLockSpacing(!lockSpacing),
            title: lockSpacing ? 'Spacing linked' : 'Spacing independent',
            style: {
              width: 28, height: 28, marginBottom: 1,
              background: lockSpacing ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
              border: lockSpacing ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 4,
              color: lockSpacing ? '#00d4ff' : '#555570',
              cursor: 'pointer', fontSize: 12,
            },
          }, lockSpacing ? '🔗' : '🔓'),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('label', { style: { fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 4 } }, 'Spacing Y (mm)'),
            React.createElement('input', {
              type: 'text',
              inputMode: 'decimal',
              value: numDisplay('spacingY', spacingY),
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNumDrafts(d => ({ ...d, spacingY: e.target.value })),
              onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                setNumDrafts(d => {
                  const n = { ...d };
                  delete n.spacingY;
                  return n;
                });
                let val = parseFloat(e.target.value);
                if (!Number.isFinite(val)) val = spacingY;
                handleSpacingY(Math.max(0, Math.min(100, val)));
              },
              style: {
                width: '100%', padding: '5px 8px',
                background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
                color: '#e0e0ec', fontSize: 12, fontFamily: mono, outline: 'none',
              },
            }),
          ),
        ),
      ),

      // Footer
      React.createElement('div', {
        style: {
          padding: '12px 18px',
          borderTop: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
      },
        React.createElement('span', {
          style: { fontSize: 11, color: '#555570' },
        }, `${cols * rows} copies · ${(cols * (sourceWidth + spacingX) - spacingX).toFixed(1)} × ${(rows * (sourceHeight + spacingY) - spacingY).toFixed(1)} mm`),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            onClick: onCancel,
            style: {
              padding: '7px 16px', background: '#1a1a2e', border: '1px solid #252540',
              borderRadius: 6, color: '#8888aa', fontSize: 12, cursor: 'pointer',
              fontFamily: font,
            },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: () => onConfirm({ cols, rows, spacingX, spacingY }),
            style: {
              padding: '7px 20px', background: 'rgba(0, 212, 255, 0.12)',
              border: '1px solid #00d4ff', borderRadius: 6,
              color: '#00d4ff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: font,
            },
          }, 'Create Array'),
        ),
      ),
    ),
  );
}
