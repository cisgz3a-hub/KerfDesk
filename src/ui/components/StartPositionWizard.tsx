import React, { useState, useMemo } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { computeObjectBounds } from '../../geometry/bounds';

export type StartMode = 'absolute' | 'current' | 'savedOrigin';

interface StartPositionWizardProps {
  scene: Scene;
  currentMode: StartMode;
  onSelectMode: (mode: StartMode) => void;
  onClose: () => void;
  machinePosition?: { x: number; y: number } | null;
  savedOrigin?: { x: number; y: number } | null;
}

export function StartPositionWizard({
  scene, currentMode, onSelectMode, onClose, machinePosition, savedOrigin,
}: StartPositionWizardProps) {
  const [hoveredMode, setHoveredMode] = useState<StartMode | null>(null);

  const font = "'DM Sans', system-ui, sans-serif";

  const designBounds = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const obj of scene.objects) {
      if (!obj.visible) continue;
      const b = computeObjectBounds(obj);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    return { minX, minY, maxX, maxY };
  }, [scene.objects]);

  const modes: Array<{
    id: StartMode;
    icon: string;
    title: string;
    description: string;
    detail: string;
  }> = [
    {
      id: 'absolute',
      icon: '📍',
      title: 'Place on Bed',
      description: 'Design stays exactly where you placed it on the canvas.',
      detail: `Your design will cut at X${designBounds.minX.toFixed(0)}–${designBounds.maxX.toFixed(0)}, Y${designBounds.minY.toFixed(0)}–${designBounds.maxY.toFixed(0)} mm from machine home.`,
    },
    {
      id: 'current',
      icon: '🎯',
      title: 'Start Where Head Is Now',
      description: 'Design starts at the current laser position. Move the head first, then start.',
      detail: machinePosition
        ? `Head is at X${machinePosition.x.toFixed(1)}, Y${machinePosition.y.toFixed(1)}. Design will start from this point.`
        : 'Connect to your laser first to use this mode.',
    },
    {
      id: 'savedOrigin',
      icon: '⚑',
      title: 'Use Saved Origin',
      description: 'Design aligns to a previously saved reference point. Great for repeat jobs.',
      detail: savedOrigin
        ? `Saved origin: X${savedOrigin.x.toFixed(1)}, Y${savedOrigin.y.toFixed(1)}`
        : 'No origin saved yet. Zero your machine at a reference point, then save it.',
    },
  ];

  const previewMode = hoveredMode || currentMode;
  const renderPreview = () => {
    const bedW = scene.canvas.width;
    const bedH = scene.canvas.height;
    const svgW = 220;
    const svgH = 160;
    const pad = 16;
    const scale = Math.min((svgW - pad * 2) / bedW, (svgH - pad * 2) / bedH);
    const offsetX = (svgW - bedW * scale) / 2;
    const offsetY = (svgH - bedH * scale) / 2;

    let designX = designBounds.minX;
    let designY = designBounds.minY;
    if (previewMode === 'current' && machinePosition) {
      designX = machinePosition.x;
      designY = machinePosition.y;
    } else if (previewMode === 'savedOrigin' && savedOrigin) {
      designX = savedOrigin.x;
      designY = savedOrigin.y;
    }

    const dw = designBounds.maxX - designBounds.minX;
    const dh = designBounds.maxY - designBounds.minY;

    return React.createElement('svg', { width: svgW, height: svgH, style: { display: 'block', margin: '0 auto' } },
      React.createElement('rect', {
        x: offsetX, y: offsetY,
        width: bedW * scale, height: bedH * scale,
        fill: 'none', stroke: '#252540', strokeWidth: 1, strokeDasharray: '4,2',
      }),
      React.createElement('text', {
        x: offsetX + 4, y: offsetY + 10,
        fill: '#333355', fontSize: 8, fontFamily: font,
      }, `${bedW}×${bedH}mm`),
      React.createElement('rect', {
        x: offsetX + designX * scale,
        y: offsetY + designY * scale,
        width: Math.max(dw * scale, 8),
        height: Math.max(dh * scale, 8),
        fill: previewMode === currentMode ? 'rgba(0,212,255,0.2)' : 'rgba(255,212,68,0.2)',
        stroke: previewMode === currentMode ? '#00d4ff' : '#ffd444',
        strokeWidth: 1.5, rx: 2,
      }),
      previewMode !== 'absolute' && React.createElement('circle', {
        cx: offsetX + designX * scale,
        cy: offsetY + designY * scale,
        r: 4, fill: '#ff4466', stroke: '#ff4466', strokeWidth: 1,
      }),
      React.createElement('circle', {
        cx: offsetX, cy: offsetY,
        r: 3, fill: 'none', stroke: '#555570', strokeWidth: 1,
      }),
      React.createElement('text', {
        x: offsetX + 6, y: offsetY + bedH * scale - 4,
        fill: '#333355', fontSize: 7, fontFamily: font,
      }, '0,0'),
    );
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
        width: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      React.createElement('div', {
        style: { padding: '16px 20px', borderBottom: '1px solid #1a1a2e' },
      },
        React.createElement('div', { style: { color: '#e0e0ec', fontSize: 15, fontWeight: 600 } }, 'Where should your design cut?'),
        React.createElement('div', { style: { color: '#555570', fontSize: 11, marginTop: 3 } }, 'Choose how the design is positioned on your laser bed'),
      ),

      React.createElement('div', {
        style: { padding: '16px 20px', background: '#08080f', borderBottom: '1px solid #1a1a2e' },
      }, renderPreview()),

      React.createElement('div', { style: { padding: '8px 12px' } },
        ...modes.map(mode =>
          React.createElement('button', {
            key: mode.id,
            onClick: () => { onSelectMode(mode.id); onClose(); },
            onMouseEnter: () => setHoveredMode(mode.id),
            onMouseLeave: () => setHoveredMode(null),
            disabled: mode.id === 'current' && !machinePosition,
            style: {
              width: '100%', padding: '14px 16px', marginBottom: 4,
              background: currentMode === mode.id ? 'rgba(0,212,255,0.08)' : 'transparent',
              border: currentMode === mode.id ? '1px solid rgba(0,212,255,0.3)' : '1px solid transparent',
              borderRadius: 10, cursor: mode.id === 'current' && !machinePosition ? 'default' : 'pointer',
              textAlign: 'left' as const,
              opacity: mode.id === 'current' && !machinePosition ? 0.4 : 1,
              display: 'flex', gap: 14, alignItems: 'flex-start',
              transition: 'background 0.15s, border-color 0.15s',
            },
          },
            React.createElement('div', { style: { fontSize: 24, lineHeight: '1', flexShrink: 0, marginTop: 2 } }, mode.icon),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600, marginBottom: 3 } }, mode.title),
              React.createElement('div', { style: { color: '#8888aa', fontSize: 12, marginBottom: 4 } }, mode.description),
              React.createElement('div', { style: { color: '#555570', fontSize: 10 } }, mode.detail),
            ),
            currentMode === mode.id && React.createElement('div', {
              style: { color: '#00d4ff', fontSize: 11, fontWeight: 600, flexShrink: 0, marginTop: 4 },
            }, '✓ Active'),
          ),
        ),
      ),

      React.createElement('div', {
        style: { padding: '12px 20px', borderTop: '1px solid #1a1a2e', display: 'flex', justifyContent: 'flex-end' },
      },
        React.createElement('button', {
          onClick: onClose,
          style: { padding: '8px 18px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: '#8888aa', fontSize: 12, cursor: 'pointer', fontFamily: font },
        }, 'Close'),
      ),
    ),
  );
}
