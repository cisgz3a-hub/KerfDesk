import React, { useState, useMemo } from 'react';
import { generateId } from '../../core/types';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';
import { NumberInput } from './NumberInput';

interface VariableTextDialogProps {
  scene: Scene;
  sourceObject: SceneObject;
  onGenerate: (objects: SceneObject[]) => void;
  onClose: () => void;
}

export function VariableTextDialog({ scene, sourceObject, onGenerate, onClose }: VariableTextDialogProps) {
  void scene;
  const [startNumber, setStartNumber] = useState(1);
  const [endNumber, setEndNumber] = useState(10);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [zeroPad, setZeroPad] = useState(0);
  const [cols, setCols] = useState(5);
  const [spacingX, setSpacingX] = useState(10);
  const [spacingY, setSpacingY] = useState(10);

  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";
  const geom = sourceObject.geometry as TextGeometry;
  const baseText = geom.text || '';

  const lo = Math.min(startNumber, endNumber);
  const hi = Math.max(startNumber, endNumber);
  const count = Math.max(1, hi - lo + 1);
  const rows = Math.ceil(count / cols);

  const previewItems = useMemo(() => {
    const items: string[] = [];
    const previewEnd = Math.min(hi, lo + 5);
    for (let i = lo; i <= previewEnd; i++) {
      const numStr = zeroPad > 0 ? String(i).padStart(zeroPad, '0') : String(i);
      const text = baseText.replace(/\{n\}/gi, `${prefix}${numStr}${suffix}`);
      items.push(text);
    }
    if (hi - lo > 5) items.push('...');
    return items;
  }, [lo, hi, prefix, suffix, zeroPad, baseText]);

  const totalWidth = cols * (geom.fontSize * baseText.length * 0.6 + spacingX);
  const totalHeight = rows * (geom.fontSize * 1.3 + spacingY);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
    color: '#e0e0ec', fontSize: 12, outline: 'none', fontFamily: mono,
  };

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
        width: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); },
    },
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Variable Text / Serial Numbers'),
          React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 2 } }, `Base text: "${baseText}"`),
        ),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' } }, '×'),
      ),

      React.createElement('div', { style: { padding: '16px 18px', overflowY: 'auto' as const, flex: 1 } },
        !baseText.includes('{n}') && React.createElement('div', {
          style: { padding: '8px 12px', marginBottom: 12, background: 'rgba(255,170,50,0.08)', border: '1px solid rgba(255,170,50,0.2)', borderRadius: 6, fontSize: 10, color: '#ffaa32' },
        }, 'Tip: Use {n} in your text where the number should appear. Example: "Tag #{n}" → "Tag #1", "Tag #2", etc.'),

        React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 12 } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Start Number'),
            React.createElement(NumberInput, {
              value: startNumber, min: 0, max: 9999, integer: true, inputMode: 'numeric', defaultValue: 1, style: inputStyle,
              onCommit: setStartNumber,
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'End Number'),
            React.createElement(NumberInput, {
              value: endNumber, min: startNumber, max: 9999, integer: true, inputMode: 'numeric', defaultValue: 10, style: inputStyle,
              onCommit: setEndNumber,
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Zero Pad'),
            React.createElement(NumberInput, {
              value: zeroPad, min: 0, max: 6, integer: true, inputMode: 'numeric', defaultValue: 0, style: inputStyle,
              onCommit: setZeroPad,
            }),
          ),
        ),

        React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 12 } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Prefix'),
            React.createElement('input', {
              type: 'text', value: prefix, placeholder: 'e.g. #',
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPrefix(e.target.value),
              style: inputStyle,
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Suffix'),
            React.createElement('input', {
              type: 'text', value: suffix, placeholder: '',
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSuffix(e.target.value),
              style: inputStyle,
            }),
          ),
        ),

        React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 12 } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Columns'),
            React.createElement(NumberInput, {
              value: cols, min: 1, max: 20, integer: true, inputMode: 'numeric', defaultValue: 5, style: inputStyle,
              onCommit: setCols,
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Spacing X (mm)'),
            React.createElement(NumberInput, {
              value: spacingX, min: 0, max: 200, defaultValue: 10, style: inputStyle,
              onCommit: setSpacingX,
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Spacing Y (mm)'),
            React.createElement(NumberInput, {
              value: spacingY, min: 0, max: 200, defaultValue: 10, style: inputStyle,
              onCommit: setSpacingY,
            }),
          ),
        ),

        React.createElement('div', {
          style: { padding: '10px 12px', background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e', marginBottom: 12 },
        },
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 6 } }, 'PREVIEW'),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 } },
            ...previewItems.map((text, i) =>
              React.createElement('span', {
                key: i,
                style: {
                  padding: '3px 8px', background: '#12121e', borderRadius: 4,
                  border: '1px solid #252540', fontSize: 11, color: '#e0e0ec',
                  fontFamily: geom.fontFamily || font,
                  fontWeight: geom.bold ? 'bold' : 'normal',
                  fontStyle: geom.italic ? 'italic' : 'normal',
                },
              }, text),
            ),
          ),
        ),

        React.createElement('div', { style: { fontSize: 10, color: '#555570' } },
          `${count} copies in ${cols}×${rows} grid • ~${totalWidth.toFixed(0)}×${totalHeight.toFixed(0)}mm`,
        ),
      ),

      React.createElement('div', { style: { padding: '12px 18px', borderTop: '1px solid #1a1a2e', flexShrink: 0 } },
        React.createElement('button', {
          onClick: () => {
            const objects: SceneObject[] = [];
            const baseX = sourceObject.transform.tx;
            const baseY = sourceObject.transform.ty;
            const itemWidth = geom.fontSize * Math.max(baseText.length, 3) * 0.6 + spacingX;
            const itemHeight = geom.fontSize * 1.3 + spacingY;

            let index = 0;
            for (let num = lo; num <= hi; num++) {
              const col = index % cols;
              const row = Math.floor(index / cols);
              const numStr = zeroPad > 0 ? String(num).padStart(zeroPad, '0') : String(num);
              const text = baseText.includes('{n}')
                ? baseText.replace(/\{n\}/gi, `${prefix}${numStr}${suffix}`)
                : `${baseText} ${prefix}${numStr}${suffix}`;

              objects.push({
                id: generateId(),
                type: 'text',
                name: text.length > 20 ? text.slice(0, 20) + '...' : text,
                layerId: sourceObject.layerId,
                parentId: null,
                transform: {
                  a: sourceObject.transform.a,
                  b: 0,
                  c: 0,
                  d: sourceObject.transform.d,
                  tx: baseX + col * itemWidth,
                  ty: baseY + row * itemHeight,
                },
                geometry: {
                  type: 'text',
                  text,
                  fontSize: geom.fontSize,
                  fontFamily: geom.fontFamily,
                  bold: geom.bold,
                  italic: geom.italic,
                },
                visible: true,
                locked: false,
                powerScale: sourceObject.powerScale ?? 1.0,
                cutStartIndex: 0,
                _bounds: null,
                _worldTransform: null,
              });

              index++;
            }

            onGenerate(objects);
            onClose();
          },
          style: {
            width: '100%', padding: '10px',
            background: 'rgba(45,212,160,0.1)',
            border: '1px solid #2dd4a0',
            borderRadius: 8, color: '#2dd4a0',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: font,
          },
        }, `Generate ${count} Numbered Copies`),
      ),
    ),
  );
}
