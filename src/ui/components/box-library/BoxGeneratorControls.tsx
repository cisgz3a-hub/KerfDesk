import React, { useEffect, useRef, useState } from 'react';
import { type BoxFace, computeBoxJointMetrics, exteriorToInterior } from '../../../core/box/boxGeometry';
import { KERF_PRESETS, findPresetIdForKerf } from '../../../core/box/kerfPresets';
import { NumberInput } from '../NumberInput';

type DimensionMode = 'outside' | 'inside';

interface BoxGeneratorControlsProps {
  width: number;
  height: number;
  depth: number;
  thickness: number;
  fingerWidth: number;
  kerf: number;
  fitAllowance: number;
  openTop: boolean;
  dimensionMode: DimensionMode;
  resolved: { width: number; height: number; depth: number };
  faces: BoxFace[];
  sourceText: string;
  onWidthChange: (value: number) => void;
  onHeightChange: (value: number) => void;
  onDepthChange: (value: number) => void;
  onThicknessChange: (value: number) => void;
  onFingerWidthChange: (value: number) => void;
  onKerfChange: (value: number) => void;
  onFitAllowanceChange: (value: number) => void;
  onOpenTopChange: (value: boolean) => void;
  onDimensionModeChange: (value: DimensionMode) => void;
  onGenerate: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

export function BoxGeneratorControls(props: BoxGeneratorControlsProps) {
  const [activeTab, setActiveTab] = useState<'layout' | 'assembly' | 'notes'>('layout');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cavity = props.dimensionMode === 'outside'
    ? exteriorToInterior(props.width, props.height, props.depth, props.thickness, props.openTop)
    : { width: props.width, height: props.height, depth: props.depth };
  const jointMetrics = computeBoxJointMetrics(props.thickness, props.kerf, props.fitAllowance);
  const materialAreaCm2 = Math.round(
    ((props.resolved.width * props.resolved.height * 2)
      + (props.resolved.depth * props.resolved.height * 2)
      + (props.resolved.width * props.resolved.depth * (props.openTop ? 1 : 2))) / 100,
  );

  useEffect(() => {
    drawLayoutPreview(canvasRef.current, props.faces, props.resolved);
  }, [props.faces, props.resolved]);

  return React.createElement('div', {
    style: {
      minWidth: 0,
      minHeight: 0,
      overflowY: 'auto' as const,
      padding: 14,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 9,
    },
  },
    React.createElement('div', {
      style: {
        position: 'sticky' as const,
        top: 0,
        zIndex: 2,
        paddingBottom: 6,
        background: 'linear-gradient(#12121e 80%, rgba(18,18,30,0))',
      },
    },
      React.createElement('div', { style: { color: '#9a9ab5', fontSize: 10 } },
        'Preset source: ',
        React.createElement('span', { 'data-testid': 'box-preset-source', style: { color: '#e0e0ec' } }, props.sourceText),
      ),
    ),
    React.createElement('div', { style: sectionStyle },
      sectionTitle('Box Dimensions'),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 } },
        field('width', props.dimensionMode === 'inside' ? 'Cavity width' : 'Outer width', props.width, props.onWidthChange, 10, 500, 1),
        field('height', props.dimensionMode === 'inside' ? 'Cavity height' : 'Outer height', props.height, props.onHeightChange, 10, 500, 1),
        field('depth', props.dimensionMode === 'inside' ? 'Cavity depth' : 'Outer depth', props.depth, props.onDepthChange, 10, 500, 1),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 7, marginTop: 9 } },
        pillButton('Outside size', props.dimensionMode === 'outside', () => props.onDimensionModeChange('outside')),
        pillButton('Inside cavity', props.dimensionMode === 'inside', () => props.onDimensionModeChange('inside')),
        pillButton(props.openTop ? 'Open top' : 'Closed box', props.openTop, () => props.onOpenTopChange(!props.openTop)),
      ),
    ),
    React.createElement('div', { style: sectionStyle },
      sectionTitle('Material Setup'),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 } },
        field('thickness', 'Material thickness', props.thickness, props.onThicknessChange, 1, 20, 0.1),
        field('fingerWidth', 'Finger width', props.fingerWidth, props.onFingerWidthChange, 3, 50, 1),
      ),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 8 } },
        React.createElement('div', null,
          label('Kerf preset'),
          React.createElement('select', {
            value: findPresetIdForKerf(props.kerf),
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const preset = KERF_PRESETS.find(p => p.id === e.target.value);
              if (preset) props.onKerfChange(preset.kerf);
            },
            style: inputStyle,
          }, ...KERF_PRESETS.map(p => React.createElement('option', { key: p.id, value: p.id }, p.label))),
        ),
        field('kerf', 'Kerf', props.kerf, props.onKerfChange, 0, 1, 0.05),
        field('fitAllowance', 'Fit allowance', props.fitAllowance, props.onFitAllowanceChange, 0, 0.5, 0.01),
      ),
    ),
    React.createElement('div', { style: statsGridStyle },
      statCard(props.dimensionMode === 'inside' ? 'Cut size' : 'Inside cavity',
        props.dimensionMode === 'inside'
          ? `${props.resolved.width} × ${props.resolved.height} × ${props.resolved.depth} mm`
          : `${cavity.width} × ${cavity.height} × ${cavity.depth} mm`),
      statCard('Joint clearance', `~${jointMetrics.expectedWidthClearance.toFixed(2)} mm`),
      statCard('Faces', `${props.openTop ? 5 : 6}`),
      statCard('Material', `${props.thickness} mm`),
      statCard('Layout area', `~${materialAreaCm2} cm²`),
    ),
    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 } },
        sectionTitle('Generated Layout'),
        React.createElement('div', { style: { display: 'flex', gap: 6 } },
          tabButton('Layout', activeTab === 'layout', () => setActiveTab('layout')),
          tabButton('Assembly', activeTab === 'assembly', () => setActiveTab('assembly')),
          tabButton('Notes', activeTab === 'notes', () => setActiveTab('notes')),
        ),
      ),
      activeTab === 'layout'
        ? React.createElement('canvas', {
            ref: canvasRef,
            style: {
              width: '100%',
              background: '#08080f',
              borderRadius: 12,
              border: '1px solid #252540',
              display: 'block',
            },
          })
        : activeTab === 'assembly'
          ? infoPanel('Assembly preview will use the same finger-joint layout: bottom first, side walls next, lid/top last when enabled.')
          : infoPanel('Best results: test a calibration coupon for new material, confirm kerf with calipers, then generate the full-size box.'),
    ),
    React.createElement('button', {
      type: 'button',
      onClick: props.onGenerate,
      style: {
        width: '100%',
        padding: '9px 12px',
        background: 'rgba(45,212,160,0.14)',
        border: '1px solid #2dd4a0',
        borderRadius: 10,
        color: '#2dd4a0',
        fontSize: 13,
        fontWeight: 800,
        cursor: 'pointer',
        fontFamily: font,
      },
    }, `Create ${props.openTop ? 5 : 6}-Face Box`),
  );
}

function drawLayoutPreview(
  canvas: HTMLCanvasElement | null,
  faces: BoxFace[],
  resolved: { width: number; height: number; depth: number },
): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = 520;
  // Keep the generated layout visible on common laptop-height screens.
  // The previous fixed 360px canvas pushed the bottom of the right panel
  // below the viewport at 1366x768.
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 900;
  const h = viewportH < 740 ? 118 : viewportH < 820 ? 150 : viewportH < 900 ? 210 : 320;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, w, h);
  if (faces.length === 0) return;

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const face of faces) {
    for (const p of face.points) {
      minX = Math.min(minX, p.x + face.offsetX);
      minY = Math.min(minY, p.y + face.offsetY);
      maxX = Math.max(maxX, p.x + face.offsetX);
      maxY = Math.max(maxY, p.y + face.offsetY);
    }
  }
  const scale = Math.min((w - 32) / ((maxX - minX) || 1), (h - 28) / ((maxY - minY) || 1));
  const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (h - (maxY - minY) * scale) / 2 - minY * scale;
  for (const face of faces) {
    const pts = face.points;
    if (pts.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo((pts[0]!.x + face.offsetX) * scale + ox, (pts[0]!.y + face.offsetY) * scale + oy);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo((pts[i]!.x + face.offsetX) * scale + ox, (pts[i]!.y + face.offsetY) * scale + oy);
    }
    ctx.closePath();
    ctx.strokeStyle = '#ff4466';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const cx = face.offsetX + (face.name === 'Front' || face.name === 'Back' ? resolved.width / 2 : resolved.depth / 2);
    const cy = face.offsetY + (face.name === 'Bottom' || face.name === 'Top' ? resolved.depth / 2 : resolved.height / 2);
    ctx.fillStyle = '#666680';
    ctx.font = `${Math.max(9, Math.min(13, scale * 5))}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face.name, cx * scale + ox, cy * scale + oy);
  }
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '5px 8px',
  background: '#0a0a14',
  border: '1px solid #252540',
  borderRadius: 7,
  color: '#e0e0ec',
  fontSize: 11,
  outline: 'none',
  fontFamily: mono,
};

const sectionStyle: React.CSSProperties = {
  background: '#10131c',
  border: '1px solid #252540',
  borderRadius: 12,
  padding: 9,
};

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: 6,
};

function label(text: string): React.ReactNode {
  return React.createElement('div', { style: { fontSize: 8.5, color: '#6f6f89', marginBottom: 3 } }, text);
}

function field(
  key: string,
  title: string,
  value: number,
  setter: (value: number) => void,
  min: number,
  max: number,
  step: number,
): React.ReactNode {
  return React.createElement('div', { key },
    label(`${title} (mm)`),
    React.createElement(NumberInput, {
      value,
      min,
      max,
      step,
      defaultValue: value,
      style: inputStyle,
      onChange: setter,
      onCommit: setter,
    }),
  );
}

function sectionTitle(text: string): React.ReactNode {
  return React.createElement('div', { style: { color: '#e0e0ec', fontSize: 11, fontWeight: 800, marginBottom: 7 } }, text);
}

function pillButton(text: string, active: boolean, onClick: () => void): React.ReactNode {
  return React.createElement('button', {
    type: 'button',
    onClick,
    style: {
      flex: 1,
      padding: '5px 8px',
      borderRadius: 8,
      border: active ? '1px solid #00d4ff' : '1px solid #252540',
      background: active ? 'rgba(0,212,255,0.10)' : '#0a0a14',
      color: active ? '#d0e8ff' : '#9a9ab5',
      fontSize: 9.5,
      cursor: 'pointer',
      fontFamily: font,
    },
  }, text);
}

function statCard(labelText: string, value: string): React.ReactNode {
  return React.createElement('div', {
    style: {
      background: '#10131c',
      border: '1px solid #252540',
      borderRadius: 12,
      padding: '7px 8px',
    },
  },
    React.createElement('div', { style: { color: '#6f6f89', fontSize: 7.5, textTransform: 'uppercase' as const, letterSpacing: 0.4 } }, labelText),
    React.createElement('div', { style: { color: '#e0e0ec', fontSize: 10.5, fontWeight: 800, marginTop: 3, fontFamily: mono } }, value),
  );
}

function tabButton(text: string, active: boolean, onClick: () => void): React.ReactNode {
  return React.createElement('button', {
    type: 'button',
    onClick,
    style: {
      padding: '4px 7px',
      borderRadius: 999,
      border: active ? '1px solid #00d4ff' : '1px solid #252540',
      background: active ? 'rgba(0,212,255,0.10)' : '#0a0a14',
      color: active ? '#d0e8ff' : '#8f8faa',
      fontSize: 8,
      cursor: 'pointer',
    },
  }, text);
}

function infoPanel(text: string): React.ReactNode {
  return React.createElement('div', {
    style: {
      minHeight: 240,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center' as const,
      color: '#9a9ab5',
      lineHeight: 1.6,
      background: '#08080f',
      border: '1px solid #252540',
      borderRadius: 12,
      padding: 22,
      fontSize: 12,
    },
  }, text);
}
