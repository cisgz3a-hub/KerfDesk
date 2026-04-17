import React, { useMemo } from 'react';
import type { Scene } from '../../core/scene/Scene';
import { computeObjectBounds } from '../../geometry/bounds';
import { theme } from '../styles/theme';

export interface StatusFooterProps {
  scene: Scene;
  zoomLevel: number;
  productionMode: boolean;
  textPlacementHint: string | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToBed: () => void;
}

export function StatusFooter({
  scene,
  zoomLevel,
  productionMode,
  textPlacementHint,
  onZoomIn,
  onZoomOut,
  onFitToBed,
}: StatusFooterProps) {
  const materialWarning = useMemo(() => {
    if (!scene.material) return null;
    const mat = scene.material;
    let outCount = 0;
    for (const obj of scene.objects) {
      if (!obj.visible) continue;
      const b = computeObjectBounds(obj);
      if (!b) continue;
      if (b.minX < mat.x || b.minY < mat.y ||
          b.maxX > mat.x + mat.width || b.maxY > mat.y + mat.height) {
        outCount++;
      }
    }
    if (outCount > 0) {
      return React.createElement('span', {
        style: { color: '#ff4466', fontSize: '10px', fontFamily: "'DM Sans', system-ui", display: 'flex', alignItems: 'center', gap: 3 },
      }, `⚠ ${outCount} object${outCount > 1 ? 's' : ''} outside material`);
    }
    return null;
  }, [scene]);

  return React.createElement('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '3px 12px',
      background: theme.bg.panel,
      borderTop: `1px solid ${theme.border.subtle}`,
      fontSize: theme.font.size.xs,
      fontFamily: theme.font.mono,
      color: theme.text.tertiary,
      height: 24,
      flexShrink: 0,
    },
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      React.createElement('span', {
        style: { fontSize: '9px', color: '#333355', fontFamily: "'JetBrains Mono', monospace" },
      }, 'v0.1.0'),
      React.createElement('span', {}, scene.metadata.name || 'Untitled'),
      React.createElement('span', {
        style: {
          fontSize: 9, color: productionMode ? '#ffaa32' : '#2dd4a0',
          marginLeft: 8, opacity: 0.6,
        },
      }, productionMode ? 'Production Mode' : 'Beginner Mode'),
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      textPlacementHint && React.createElement('span', {
        style: {
          fontSize: '10px',
          color: '#ffaa32',
          fontFamily: "'DM Sans', system-ui, sans-serif",
          maxWidth: 420,
        },
      }, textPlacementHint),
      React.createElement('span', {}, `${scene.canvas.width} × ${scene.canvas.height} mm`),
      React.createElement('span', {
        title: 'The laser head moves here before cutting begins, and returns here when done. Drag the green dot on the canvas to change.',
        style: {
          fontSize: '10px',
          color: '#2dd4a0',
          cursor: 'help',
          fontFamily: "'JetBrains Mono', monospace",
          borderBottom: '1px dotted #2dd4a0',
        },
      }, `⌂ ${scene.startPosition.x}, ${scene.startPosition.y}`),
      materialWarning,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        React.createElement('button', {
          onClick: onZoomOut,
          style: { background: 'none', border: 'none', color: '#8888aa', cursor: 'pointer', fontSize: 14, padding: '0 4px', fontFamily: "'DM Sans', system-ui" },
          title: 'Zoom out',
        }, '−'),
        React.createElement('span', {
          style: { fontSize: 10, color: '#555570', fontFamily: "'JetBrains Mono', monospace", minWidth: 40, textAlign: 'center' as const },
        }, `${zoomLevel}%`),
        React.createElement('button', {
          onClick: onZoomIn,
          style: { background: 'none', border: 'none', color: '#8888aa', cursor: 'pointer', fontSize: 14, padding: '0 4px', fontFamily: "'DM Sans', system-ui" },
          title: 'Zoom in',
        }, '+'),
        React.createElement('button', {
          onClick: onFitToBed,
          style: { background: 'none', border: '1px solid #252540', borderRadius: 3, color: '#8888aa', cursor: 'pointer', fontSize: 9, padding: '2px 6px', fontFamily: "'DM Sans', system-ui", marginLeft: 4 },
          title: 'Fit to bed',
        }, 'FIT'),
      ),
    ),
  );
}
