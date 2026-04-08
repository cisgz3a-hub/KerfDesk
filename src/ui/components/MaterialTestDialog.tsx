import React, { useState, useRef, useEffect } from 'react';

export interface MaterialTestConfig {
  rows: number;
  cols: number;
  cellSize: number;
  spacing: number;
  powerMin: number;
  powerMax: number;
  speedMin: number;
  speedMax: number;
}

interface MaterialTestDialogProps {
  onConfirm: (config: MaterialTestConfig) => void;
  onCancel: () => void;
}

export function MaterialTestDialog({ onConfirm, onCancel }: MaterialTestDialogProps) {
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(5);
  const [cellSize, setCellSize] = useState(10);
  const [spacing, setSpacing] = useState(2);
  const [powerMin, setPowerMin] = useState(10);
  const [powerMax, setPowerMax] = useState(100);
  const [speedMin, setSpeedMin] = useState(100);
  const [speedMax, setSpeedMax] = useState(1000);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
  const mono = "'JetBrains Mono', 'Consolas', monospace";

  // Draw preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = 340;
    const ch = 220;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, cw, ch);

    const totalW = cols * cellSize + (cols - 1) * spacing;
    const totalH = rows * cellSize + (rows - 1) * spacing;
    const labelPad = 30;
    const scale = Math.min((cw - labelPad - 20) / totalW, (ch - labelPad - 20) / totalH, 3);
    const ox = labelPad + (cw - labelPad - totalW * scale) / 2;
    const oy = labelPad + (ch - labelPad - totalH * scale) / 2;

    // Draw axis labels
    ctx.font = '9px ' + mono;
    ctx.fillStyle = '#555570';

    // Speed label (top)
    ctx.textAlign = 'center';
    ctx.fillText('Speed (mm/min) →', cw / 2, 10);

    // Power label (left)
    ctx.save();
    ctx.translate(10, ch / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Power (%) →', 0, 0);
    ctx.restore();

    // Draw grid cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * (cellSize + spacing) * scale;
        const y = oy + r * (cellSize + spacing) * scale;
        const w = cellSize * scale;
        const h = cellSize * scale;

        // Compute power and speed for this cell
        const power = rows === 1 ? powerMin : powerMin + (r / (rows - 1)) * (powerMax - powerMin);
        const speed = cols === 1 ? speedMin : speedMin + (c / (cols - 1)) * (speedMax - speedMin);

        // Color intensity based on power/speed ratio (higher power + lower speed = darker)
        const intensity = (power / 100) * (1 - (speed - speedMin) / (speedMax - speedMin + 1) * 0.7);
        const gray = Math.round(255 * (1 - intensity));

        ctx.fillStyle = `rgb(${gray}, ${Math.round(gray * 0.7)}, ${Math.round(gray * 0.5)})`;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, w, h);
      }
    }

    // Column speed labels
    ctx.font = '7px ' + mono;
    ctx.fillStyle = '#555570';
    ctx.textAlign = 'center';
    for (let c = 0; c < cols; c++) {
      const speed = cols === 1 ? speedMin : speedMin + (c / (cols - 1)) * (speedMax - speedMin);
      const x = ox + c * (cellSize + spacing) * scale + cellSize * scale / 2;
      ctx.fillText(Math.round(speed).toString(), x, oy - 4);
    }

    // Row power labels
    ctx.textAlign = 'right';
    for (let r = 0; r < rows; r++) {
      const power = rows === 1 ? powerMin : powerMin + (r / (rows - 1)) * (powerMax - powerMin);
      const y = oy + r * (cellSize + spacing) * scale + cellSize * scale / 2 + 3;
      ctx.fillText(Math.round(power) + '%', ox - 4, y);
    }

  }, [rows, cols, cellSize, spacing, powerMin, powerMax, speedMin, speedMax]);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '4px 6px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
    color: '#e0e0ec', fontSize: 11, fontFamily: mono, outline: 'none',
    textAlign: 'center' as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: '#8888aa', marginBottom: 2,
    fontFamily: font,
  };

  const field = (label: string, value: number, onChange: (v: number) => void, min: number, max: number, step: number = 1) =>
    React.createElement('div', { style: { flex: 1 } },
      React.createElement('div', { style: labelStyle }, label),
      React.createElement('input', {
        type: 'number', value, min, max, step,
        style: inputStyle,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || min))),
      }),
    );

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onCancel(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 12,
        width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: {
          padding: '14px 18px', borderBottom: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
      },
        React.createElement('div', null,
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Material Test Generator'),
          React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 2 } }, 'Find optimal power & speed for your material'),
        ),
        React.createElement('button', {
          onClick: onCancel,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer', padding: '0 4px' },
        }, '×'),
      ),

      // Preview
      React.createElement('div', { style: { padding: '12px 18px 8px', borderBottom: '1px solid #1a1a2e' } },
        React.createElement('canvas', {
          ref: canvasRef,
          style: { width: '100%', height: 220, borderRadius: 8 },
        }),
      ),

      // Controls
      React.createElement('div', { style: { padding: '12px 18px', display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        // Grid size
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          field('Columns', cols, setCols, 2, 10),
          field('Rows', rows, setRows, 2, 10),
          field('Cell (mm)', cellSize, setCellSize, 5, 30),
          field('Gap (mm)', spacing, setSpacing, 1, 10),
        ),
        // Power range
        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
          field('Power Min %', powerMin, setPowerMin, 1, 99),
          React.createElement('span', { style: { color: '#555570', paddingBottom: 6, fontSize: 12 } }, '→'),
          field('Power Max %', powerMax, setPowerMax, 2, 100),
        ),
        // Speed range
        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
          field('Speed Min', speedMin, setSpeedMin, 10, 9999),
          React.createElement('span', { style: { color: '#555570', paddingBottom: 6, fontSize: 12 } }, '→'),
          field('Speed Max', speedMax, setSpeedMax, 20, 10000),
        ),
      ),

      // Footer
      React.createElement('div', {
        style: {
          padding: '12px 18px', borderTop: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
      },
        React.createElement('span', { style: { fontSize: 10, color: '#555570' } },
          `${rows * cols} squares · ${(cols * (cellSize + spacing) - spacing).toFixed(0)}×${(rows * (cellSize + spacing) - spacing).toFixed(0)} mm`
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            onClick: onCancel,
            style: { padding: '7px 16px', background: '#1a1a2e', border: '1px solid #252540', borderRadius: 6, color: '#8888aa', fontSize: 12, cursor: 'pointer', fontFamily: font },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: () => onConfirm({ rows, cols, cellSize, spacing, powerMin, powerMax, speedMin, speedMax }),
            style: { padding: '7px 20px', background: 'rgba(0, 212, 255, 0.12)', border: '1px solid #00d4ff', borderRadius: 6, color: '#00d4ff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: font },
          }, 'Generate Test'),
        ),
      ),
    ),
  );
}
