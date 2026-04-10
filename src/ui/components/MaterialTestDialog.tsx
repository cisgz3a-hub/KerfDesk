import React, { useState, useMemo, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { generateId } from '../../core/types';
import { NumberInput } from './NumberInput';

interface MaterialTestDialogProps {
  scene: Scene;
  onApply: (objects: SceneObject[], layerSettings: Array<{ power: number; speed: number }>, mode: 'cut' | 'engrave') => void;
  onClose: () => void;
}

export function MaterialTestDialog({ scene, onApply, onClose }: MaterialTestDialogProps) {
  const [powerMin, setPowerMin] = useState(20);
  const [powerMax, setPowerMax] = useState(100);
  const [speedMin, setSpeedMin] = useState(200);
  const [speedMax, setSpeedMax] = useState(2000);
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(5);
  const [squareSize, setSquareSize] = useState(10);
  const [gap, setGap] = useState(3);
  const [mode, setMode] = useState<'cut' | 'engrave'>('engrave');

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '5px 7px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 5,
    color: '#e0e0ec', fontSize: 11, outline: 'none', fontFamily: mono,
  };

  const grid = useMemo(() => {
    const cells: Array<{ row: number; col: number; power: number; speed: number }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const power = rows === 1 ? powerMin : powerMin + (powerMax - powerMin) * (r / (rows - 1));
        const speed = cols === 1 ? speedMin : speedMin + (speedMax - speedMin) * (c / (cols - 1));
        cells.push({ row: r, col: c, power: Math.round(power), speed: Math.round(speed) });
      }
    }
    return cells;
  }, [rows, cols, powerMin, powerMax, speedMin, speedMax]);

  const totalWidth = cols * squareSize + (cols - 1) * gap;
  const totalHeight = rows * squareSize + (rows - 1) * gap;
  const labelHeight = 12;

  const previewW = 280;
  const previewH = 220;
  const svgTotalW = totalWidth + labelHeight + 5;
  const svgTotalH = totalHeight + labelHeight + 5;
  const scale = Math.min((previewW - 20) / svgTotalW, (previewH - 20) / svgTotalH);
  const offsetX = (previewW - svgTotalW * scale) / 2;
  const offsetY = (previewH - svgTotalH * scale) / 2;

  const handleApply = useCallback(() => {
    const objects: SceneObject[] = [];
    const layerSettings: Array<{ power: number; speed: number }> = [];

    const uid = () => generateId();

    const startX = scene.material
      ? scene.material.x + (scene.material.width - totalWidth) / 2
      : (scene.canvas.width - totalWidth) / 2;
    const startY = scene.material
      ? scene.material.y + (scene.material.height - totalHeight) / 2
      : (scene.canvas.height - totalHeight) / 2;

    const defaultLayerId = scene.layers[0]?.id ?? '';

    for (const cell of grid) {
      const x = startX + cell.col * (squareSize + gap);
      const y = startY + cell.row * (squareSize + gap);

      objects.push({
        id: uid(),
        type: 'rect',
        name: `Test P${cell.power} S${cell.speed}`,
        visible: true,
        locked: false,
        layerId: defaultLayerId,
        parentId: null,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
        geometry: {
          type: 'rect',
          x: 0,
          y: 0,
          width: squareSize,
          height: squareSize,
          cornerRadius: 0,
        },
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      });

      objects.push({
        id: uid(),
        type: 'text',
        name: `Label P${cell.power} S${cell.speed}`,
        visible: true,
        locked: false,
        layerId: defaultLayerId,
        parentId: null,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y + squareSize + 0.5 },
        geometry: {
          type: 'text',
          text: `${cell.power}%\n${cell.speed}`,
          fontSize: 1.8,
          fontFamily: 'sans-serif',
          bold: false,
          italic: false,
        },
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      });

      layerSettings.push({ power: cell.power, speed: cell.speed });
    }

    objects.push({
      id: uid(),
      type: 'text',
      name: 'Speed Label',
      visible: true,
      locked: false,
      layerId: defaultLayerId,
      parentId: null,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: startX + totalWidth / 2 - 8, ty: startY - 5 },
      geometry: {
        type: 'text',
        text: `Speed → (${speedMin}–${speedMax} mm/min)`,
        fontSize: 2.5,
        fontFamily: 'sans-serif',
        bold: true,
        italic: false,
      },
      powerScale: 1,
      _bounds: null,
      _worldTransform: null,
    });

    objects.push({
      id: uid(),
      type: 'text',
      name: 'Power Label',
      visible: true,
      locked: false,
      layerId: defaultLayerId,
      parentId: null,
      transform: { a: 0, b: -1, c: 1, d: 0, tx: startX - 5, ty: startY + totalHeight / 2 + 8 },
      geometry: {
        type: 'text',
        text: `Power ↓ (${powerMin}–${powerMax}%)`,
        fontSize: 2.5,
        fontFamily: 'sans-serif',
        bold: true,
        italic: false,
      },
      powerScale: 1,
      _bounds: null,
      _worldTransform: null,
    });

    onApply(objects, layerSettings, mode);
    onClose();
  }, [scene, grid, squareSize, gap, totalWidth, totalHeight, speedMin, speedMax, powerMin, powerMax, mode, onApply, onClose]);

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
        width: 620, maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
      },
        React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Material Test Grid'),
        React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 2 } },
          'Generate a grid of test squares with varying power and speed to find optimal settings',
        ),
      ),

      React.createElement('div', {
        style: { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 },
      },
        React.createElement('div', {
          style: { width: 260, padding: '12px 16px', borderRight: '1px solid #1a1a2e', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 10 },
        },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 3, textTransform: 'uppercase' as const } }, 'Test Mode'),
            React.createElement('div', { style: { display: 'flex', gap: 4 } },
              React.createElement('button', {
                onClick: () => setMode('engrave'),
                style: {
                  flex: 1, padding: '5px', fontSize: 11, borderRadius: 4, cursor: 'pointer', fontFamily: font,
                  background: mode === 'engrave' ? 'rgba(0,212,255,0.1)' : '#0a0a14',
                  border: mode === 'engrave' ? '1px solid #00d4ff' : '1px solid #252540',
                  color: mode === 'engrave' ? '#00d4ff' : '#555570',
                },
              }, 'Engrave'),
              React.createElement('button', {
                onClick: () => setMode('cut'),
                style: {
                  flex: 1, padding: '5px', fontSize: 11, borderRadius: 4, cursor: 'pointer', fontFamily: font,
                  background: mode === 'cut' ? 'rgba(255,68,102,0.1)' : '#0a0a14',
                  border: mode === 'cut' ? '1px solid #ff4466' : '1px solid #252540',
                  color: mode === 'cut' ? '#ff4466' : '#555570',
                },
              }, 'Cut'),
            ),
          ),

          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 3, textTransform: 'uppercase' as const } }, 'Power Range (%)'),
            React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              React.createElement(NumberInput, { value: powerMin, min: 1, max: 100, integer: true, inputMode: 'numeric', defaultValue: 20, style: inputStyle, onCommit: setPowerMin }),
              React.createElement('span', { style: { color: '#555570', fontSize: 10 } }, '→'),
              React.createElement(NumberInput, { value: powerMax, min: 1, max: 100, integer: true, inputMode: 'numeric', defaultValue: 100, style: inputStyle, onCommit: setPowerMax }),
            ),
          ),

          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 3, textTransform: 'uppercase' as const } }, 'Speed Range (mm/min)'),
            React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              React.createElement(NumberInput, { value: speedMin, min: 10, max: 10000, integer: true, inputMode: 'numeric', defaultValue: 200, style: inputStyle, onCommit: setSpeedMin }),
              React.createElement('span', { style: { color: '#555570', fontSize: 10 } }, '→'),
              React.createElement(NumberInput, { value: speedMax, min: 10, max: 10000, integer: true, inputMode: 'numeric', defaultValue: 2000, style: inputStyle, onCommit: setSpeedMax }),
            ),
          ),

          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 3, textTransform: 'uppercase' as const } }, 'Grid Size (rows × columns)'),
            React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              React.createElement(NumberInput, { value: rows, min: 1, max: 10, integer: true, inputMode: 'numeric', defaultValue: 5, style: inputStyle, onCommit: setRows }),
              React.createElement('span', { style: { color: '#555570', fontSize: 10 } }, '×'),
              React.createElement(NumberInput, { value: cols, min: 1, max: 10, integer: true, inputMode: 'numeric', defaultValue: 5, style: inputStyle, onCommit: setCols }),
            ),
          ),

          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 3, textTransform: 'uppercase' as const } }, 'Square (mm)'),
              React.createElement(NumberInput, { value: squareSize, min: 3, max: 50, defaultValue: 10, style: inputStyle, onCommit: setSquareSize }),
            ),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 3, textTransform: 'uppercase' as const } }, 'Gap (mm)'),
              React.createElement(NumberInput, { value: gap, min: 1, max: 20, integer: true, inputMode: 'numeric', defaultValue: 3, style: inputStyle, onCommit: setGap }),
            ),
          ),

          React.createElement('div', {
            style: { padding: '8px 10px', background: '#08080f', borderRadius: 6, border: '1px solid #1a1a2e', marginTop: 4 },
          },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 4, textTransform: 'uppercase' as const } }, 'Summary'),
            React.createElement('div', { style: { fontSize: 11, color: '#e0e0ec' } }, `${rows * cols} test squares`),
            React.createElement('div', { style: { fontSize: 10, color: '#8888aa', marginTop: 2 } }, `Grid: ${totalWidth.toFixed(0)} × ${totalHeight.toFixed(0)} mm`),
            React.createElement('div', { style: { fontSize: 10, color: '#8888aa' } }, `Power: ${powerMin}% → ${powerMax}%`),
            React.createElement('div', { style: { fontSize: 10, color: '#8888aa' } }, `Speed: ${speedMin} → ${speedMax} mm/min`),
          ),
        ),

        React.createElement('div', {
          style: { flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center' },
        },
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 6, textTransform: 'uppercase' as const } }, 'Preview'),
          React.createElement('svg', {
            width: previewW, height: previewH,
            style: { background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e' },
          },
            ...grid.map(cell => {
              const x = offsetX + (labelHeight + 5 + cell.col * (squareSize + gap)) * scale;
              const y = offsetY + (labelHeight + 5 + cell.row * (squareSize + gap)) * scale;
              const intensity = cell.power / 100;
              return React.createElement('rect', {
                key: `${cell.row}-${cell.col}`,
                x, y,
                width: squareSize * scale,
                height: squareSize * scale,
                fill: mode === 'engrave'
                  ? `rgba(0, 212, 255, ${0.1 + intensity * 0.5})`
                  : `rgba(255, 68, 102, ${0.1 + intensity * 0.5})`,
                stroke: mode === 'engrave' ? '#00d4ff' : '#ff4466',
                strokeWidth: 0.5,
              });
            }),
            ...Array.from({ length: cols }, (_, c) => {
              const speed = cols === 1 ? speedMin : speedMin + (speedMax - speedMin) * (c / (cols - 1));
              const x = offsetX + (labelHeight + 5 + c * (squareSize + gap) + squareSize / 2) * scale;
              const y = offsetY + labelHeight * scale * 0.7;
              return React.createElement('text', {
                key: `col-${c}`,
                x, y, textAnchor: 'middle',
                fill: '#555570', fontSize: 7, fontFamily: mono,
              }, Math.round(speed).toString());
            }),
            ...Array.from({ length: rows }, (_, r) => {
              const power = rows === 1 ? powerMin : powerMin + (powerMax - powerMin) * (r / (rows - 1));
              const x = offsetX + labelHeight * scale * 0.5;
              const y = offsetY + (labelHeight + 5 + r * (squareSize + gap) + squareSize / 2) * scale + 3;
              return React.createElement('text', {
                key: `row-${r}`,
                x, y, textAnchor: 'middle',
                fill: '#555570', fontSize: 7, fontFamily: mono,
              }, `${Math.round(power)}%`);
            }),
          ),
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 6 } },
            'Rows = power ↓  Columns = speed →',
          ),
        ),
      ),

      React.createElement('div', {
        style: { padding: '12px 18px', borderTop: '1px solid #1a1a2e', display: 'flex', gap: 8, flexShrink: 0 },
      },
        React.createElement('button', {
          onClick: onClose,
          style: { flex: 1, padding: '10px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 8, color: '#8888aa', fontSize: 13, cursor: 'pointer', fontFamily: font },
        }, 'Cancel'),
        React.createElement('button', {
          onClick: handleApply,
          style: {
            flex: 2, padding: '10px',
            background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff',
            borderRadius: 8, color: '#00d4ff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: font,
          },
        }, `Generate ${rows * cols} Test Squares`),
      ),
    ),
  );
}
