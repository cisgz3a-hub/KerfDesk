import React, { useState } from 'react';

export interface MaterialConfig {
  type: 'wood' | 'acrylic' | 'leather' | 'paper' | 'fabric' | 'cardboard' | 'metal' | 'custom';
  name: string;
  width: number;
  height: number;
  thickness: number;
}

interface MaterialDialogProps {
  bedWidth: number;
  bedHeight: number;
  current: MaterialConfig | null;
  onConfirm: (config: MaterialConfig) => void;
  onClear: () => void;
  onCancel: () => void;
}

const PRESETS: { type: MaterialConfig['type']; label: string; emoji: string; color: string; defaults: { name: string; thickness: number } }[] = [
  { type: 'wood', label: 'Wood', emoji: '🪵', color: '#8B5A2B', defaults: { name: '3mm Birch Plywood', thickness: 3 } },
  { type: 'acrylic', label: 'Acrylic', emoji: '💎', color: '#64B4FF', defaults: { name: '3mm Clear Acrylic', thickness: 3 } },
  { type: 'leather', label: 'Leather', emoji: '🟤', color: '#A0522D', defaults: { name: '2mm Vegetable Tan', thickness: 2 } },
  { type: 'paper', label: 'Paper', emoji: '📄', color: '#C8BE96', defaults: { name: 'Cardstock 300gsm', thickness: 0.5 } },
  { type: 'fabric', label: 'Fabric', emoji: '🧵', color: '#B482B4', defaults: { name: 'Cotton Canvas', thickness: 1 } },
  { type: 'cardboard', label: 'Cardboard', emoji: '📦', color: '#AA8250', defaults: { name: '2mm Corrugated', thickness: 2 } },
  { type: 'metal', label: 'Metal', emoji: '⚙️', color: '#B4BEC8', defaults: { name: 'Anodized Aluminum', thickness: 1 } },
  { type: 'custom', label: 'Custom', emoji: '✏️', color: '#969696', defaults: { name: 'Custom Material', thickness: 3 } },
];

export function MaterialDialog({ bedWidth, bedHeight, current, onConfirm, onClear, onCancel }: MaterialDialogProps) {
  const [selectedType, setSelectedType] = useState<MaterialConfig['type']>(current?.type || 'wood');
  const [name, setName] = useState(current?.name || '3mm Birch Plywood');
  const [width, setWidth] = useState(current?.width || Math.min(200, bedWidth));
  const [height, setHeight] = useState(current?.height || Math.min(150, bedHeight));
  const [thickness, setThickness] = useState(current?.thickness || 3);

  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
  const mono = "'JetBrains Mono', 'Consolas', monospace";

  const handleTypeSelect = (preset: typeof PRESETS[0]) => {
    setSelectedType(preset.type);
    setName(preset.defaults.name);
    setThickness(preset.defaults.thickness);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '5px 8px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
    color: '#e0e0ec', fontSize: 12, fontFamily: mono, outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: '#8888aa', marginBottom: 3, fontFamily: font,
  };

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
        width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Set Material'),
          React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 2 } }, 'Define what you\'re cutting'),
        ),
        React.createElement('button', {
          onClick: onCancel,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
        }, '×'),
      ),

      // Material type grid
      React.createElement('div', {
        style: { padding: '12px 18px', display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
      },
        ...PRESETS.map(preset =>
          React.createElement('button', {
            key: preset.type,
            onClick: () => handleTypeSelect(preset),
            style: {
              width: 90, padding: '8px 4px',
              background: selectedType === preset.type ? `rgba(${preset.type === 'wood' ? '139,90,43' : '100,180,255'},0.12)` : 'rgba(255,255,255,0.03)',
              border: selectedType === preset.type ? `1px solid ${preset.color}` : '1px solid #252540',
              borderRadius: 6, cursor: 'pointer',
              display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2,
              transition: 'all 0.1s ease',
            },
          },
            React.createElement('span', { style: { fontSize: 20 } }, preset.emoji),
            React.createElement('span', {
              style: {
                fontSize: 10, color: selectedType === preset.type ? '#e0e0ec' : '#8888aa',
                fontFamily: font,
              },
            }, preset.label),
          ),
        ),
      ),

      // Settings
      React.createElement('div', {
        style: { padding: '8px 18px 16px', display: 'flex', flexDirection: 'column' as const, gap: 10 },
      },
        // Name
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, 'Material Name'),
          React.createElement('input', {
            type: 'text', value: name,
            style: inputStyle,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
          }),
        ),

        // Dimensions
        React.createElement('div', { style: { display: 'flex', gap: 10 } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: labelStyle }, 'Width (mm)'),
            React.createElement('input', {
              type: 'number', value: width, min: 10, max: bedWidth, step: 1,
              style: inputStyle,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWidth(Math.max(10, Math.min(bedWidth, parseFloat(e.target.value) || 10))),
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: labelStyle }, 'Height (mm)'),
            React.createElement('input', {
              type: 'number', value: height, min: 10, max: bedHeight, step: 1,
              style: inputStyle,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setHeight(Math.max(10, Math.min(bedHeight, parseFloat(e.target.value) || 10))),
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: labelStyle }, 'Thickness (mm)'),
            React.createElement('input', {
              type: 'number', value: thickness, min: 0.1, max: 50, step: 0.5,
              style: inputStyle,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setThickness(Math.max(0.1, parseFloat(e.target.value) || 0.1)),
            }),
          ),
        ),

        // Bed info
        React.createElement('div', {
          style: { fontSize: 10, color: '#555570', padding: '4px 0' },
        }, `Bed size: ${bedWidth} × ${bedHeight}mm — material will be centered on bed`),
      ),

      // Footer
      React.createElement('div', {
        style: {
          padding: '12px 18px', borderTop: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
      },
        React.createElement('button', {
          onClick: onClear,
          style: {
            padding: '7px 14px', background: 'transparent', border: '1px solid #333',
            borderRadius: 6, color: '#ff4466', fontSize: 11, cursor: 'pointer', fontFamily: font,
          },
        }, 'Remove Material'),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            onClick: onCancel,
            style: { padding: '7px 16px', background: '#1a1a2e', border: '1px solid #252540', borderRadius: 6, color: '#8888aa', fontSize: 12, cursor: 'pointer', fontFamily: font },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: () => onConfirm({ type: selectedType, name, width, height, thickness }),
            style: { padding: '7px 20px', background: 'rgba(0, 212, 255, 0.12)', border: '1px solid #00d4ff', borderRadius: 6, color: '#00d4ff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: font },
          }, 'Set Material'),
        ),
      ),
    ),
  );
}
