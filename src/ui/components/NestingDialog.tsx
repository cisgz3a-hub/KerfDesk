import React, { useState, useMemo } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { nestShapes, applyNesting, type NestingOptions } from '../../core/nesting/Nester';
import { NumberInput } from './NumberInput';

interface NestingDialogProps {
  scene: Scene;
  onApply: (newObjects: SceneObject[]) => void;
  onClose: () => void;
}

export function NestingDialog({ scene, onApply, onClose }: NestingDialogProps) {
  const [padding, setPadding] = useState(2);
  const [edgeMargin, setEdgeMargin] = useState(5);
  const [rotationAllowed, setRotationAllowed] = useState(true);
  const [sortMode, setSortMode] = useState<'area' | 'height' | 'width' | 'longest'>('area');
  const [useMaterialBounds, setUseMaterialBounds] = useState(true);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  // Compute bin dimensions based on material or full canvas
  const binWidth = useMaterialBounds && scene.material ? scene.material.width : scene.canvas.width;
  const binHeight = useMaterialBounds && scene.material ? scene.material.height : scene.canvas.height;
  const binX = useMaterialBounds && scene.material ? scene.material.x : 0;
  const binY = useMaterialBounds && scene.material ? scene.material.y : 0;

  // Compute nesting result for preview
  const result = useMemo(() => {
    const options: NestingOptions = {
      binWidth,
      binHeight,
      binOriginX: binX,
      binOriginY: binY,
      padding,
      edgeMargin,
      rotationAllowed,
      sortMode,
    };
    return nestShapes(scene.objects, options);
  }, [scene.objects, binWidth, binHeight, binX, binY, padding, edgeMargin, rotationAllowed, sortMode]);

  const totalShapes = scene.objects.filter(o => o.visible && !o.locked).length;
  const placedCount = result.items.length;
  const unplacedCount = result.unplaced.length;
  const efficiencyPercent = (result.efficiency * 100).toFixed(1);

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
        width: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Auto-Pack Shapes'),
          React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 2 } }, 'Arrange shapes by bounding box to minimize material waste'),
        ),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' } }, '×'),
      ),

      // Content
      React.createElement('div', { style: { display: 'flex', flex: 1, overflow: 'hidden' } },
        // Left: settings
        React.createElement('div', { style: { width: 240, padding: '14px 16px', borderRight: '1px solid #1a1a2e', overflowY: 'auto' as const } },
          // Material vs canvas
          React.createElement('div', { style: { marginBottom: 14 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 4 } }, 'Pack Into'),
            React.createElement('button', {
              onClick: () => setUseMaterialBounds(!useMaterialBounds),
              disabled: !scene.material,
              style: {
                width: '100%', padding: '6px 10px',
                background: useMaterialBounds ? 'rgba(0,212,255,0.1)' : '#0a0a14',
                border: useMaterialBounds ? '1px solid #00d4ff' : '1px solid #252540',
                borderRadius: 6, color: useMaterialBounds ? '#00d4ff' : '#8888aa',
                fontSize: 11, cursor: scene.material ? 'pointer' : 'default',
                fontFamily: font, opacity: scene.material ? 1 : 0.4,
              },
            }, useMaterialBounds && scene.material ? `Material: ${scene.material.width}×${scene.material.height}mm` : 'Full Canvas'),
          ),

          // Padding
          React.createElement('div', { style: { marginBottom: 12 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Spacing between shapes (mm)'),
            React.createElement(NumberInput, { value: padding, min: 0, max: 50, defaultValue: 2, style: inputStyle, onCommit: setPadding }),
          ),

          // Edge margin
          React.createElement('div', { style: { marginBottom: 12 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Edge margin (mm)'),
            React.createElement(NumberInput, { value: edgeMargin, min: 0, max: 100, defaultValue: 5, style: inputStyle, onCommit: setEdgeMargin }),
          ),

          // Sort mode
          React.createElement('div', { style: { marginBottom: 12 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Sort by'),
            React.createElement('select', {
              value: sortMode,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setSortMode(e.target.value as 'area' | 'height' | 'width' | 'longest'),
              style: { ...inputStyle, fontFamily: font },
            },
              React.createElement('option', { value: 'area' }, 'Largest area first'),
              React.createElement('option', { value: 'longest' }, 'Longest side first'),
              React.createElement('option', { value: 'height' }, 'Tallest first'),
              React.createElement('option', { value: 'width' }, 'Widest first'),
            ),
          ),

          // Allow rotation
          React.createElement('div', { style: { marginBottom: 12 } },
            React.createElement('button', {
              onClick: () => setRotationAllowed(!rotationAllowed),
              style: {
                width: '100%', padding: '6px 10px',
                background: rotationAllowed ? 'rgba(45,212,160,0.1)' : '#0a0a14',
                border: rotationAllowed ? '1px solid #2dd4a0' : '1px solid #252540',
                borderRadius: 6, color: rotationAllowed ? '#2dd4a0' : '#555570',
                fontSize: 11, cursor: 'pointer', fontFamily: font,
              },
            }, rotationAllowed ? '✓ Allow 90° rotation' : '☐ Allow 90° rotation'),
          ),

          // Stats
          React.createElement('div', {
            style: { marginTop: 16, padding: '10px 12px', background: '#08080f', borderRadius: 6, border: '1px solid #1a1a2e' },
          },
            React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 6 } }, 'RESULT'),
            React.createElement('div', { style: { fontSize: 11, color: '#e0e0ec', marginBottom: 3 } },
              `${placedCount} of ${totalShapes} shapes placed`,
            ),
            React.createElement('div', { style: { fontSize: 11, color: parseFloat(efficiencyPercent) > 50 ? '#2dd4a0' : '#ffd444', marginBottom: 3 } },
              `Efficiency: ${efficiencyPercent}%`,
            ),
            unplacedCount > 0 && React.createElement('div', { style: { fontSize: 10, color: '#ff4466', marginTop: 4 } },
              `⚠ ${unplacedCount} shape${unplacedCount !== 1 ? 's' : ''} too large to fit`,
            ),
          ),
        ),

        // Right: visual preview
        React.createElement('div', {
          style: { flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
        },
          React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 6 } }, 'PREVIEW'),
          React.createElement('div', {
            style: {
              flex: 1, background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e',
              position: 'relative' as const, overflow: 'hidden',
            },
          },
            (() => {
              // SVG preview
              const previewPad = 20;
              const containerW = 280;
              const containerH = 280;
              const scale = Math.min(
                (containerW - previewPad * 2) / binWidth,
                (containerH - previewPad * 2) / binHeight,
              );
              const offsetX = (containerW - binWidth * scale) / 2;
              const offsetY = (containerH - binHeight * scale) / 2;

              return React.createElement('svg', {
                width: containerW,
                height: containerH,
                style: { display: 'block', margin: '0 auto' },
              },
                // Bin outline
                React.createElement('rect', {
                  x: offsetX, y: offsetY,
                  width: binWidth * scale, height: binHeight * scale,
                  fill: 'none', stroke: '#252540', strokeWidth: 1,
                }),
                // Placed shapes
                ...result.items.map(item =>
                  React.createElement('rect', {
                    key: item.objectId,
                    x: offsetX + (item.x - binX) * scale,
                    y: offsetY + (item.y - binY) * scale,
                    width: item.width * scale,
                    height: item.height * scale,
                    fill: item.rotated ? 'rgba(255, 170, 50, 0.2)' : 'rgba(0, 212, 255, 0.2)',
                    stroke: item.rotated ? '#ffaa32' : '#00d4ff',
                    strokeWidth: 0.8,
                  }),
                ),
              );
            })(),
          ),
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 6, textAlign: 'center' as const } },
            'Blue = original orientation, Orange = rotated 90°',
          ),
        ),
      ),

      // Apply button
      React.createElement('div', {
        style: { padding: '12px 18px', borderTop: '1px solid #1a1a2e', flexShrink: 0, display: 'flex', gap: 8 },
      },
        React.createElement('button', {
          onClick: onClose,
          style: {
            flex: 1, padding: '10px',
            background: '#0a0a14', border: '1px solid #252540',
            borderRadius: 8, color: '#8888aa', fontSize: 13, cursor: 'pointer',
            fontFamily: font,
          },
        }, 'Cancel'),
        React.createElement('button', {
          onClick: () => {
            const newObjects = applyNesting(scene.objects, result);
            onApply(newObjects);
            onClose();
          },
          disabled: placedCount === 0,
          style: {
            flex: 2, padding: '10px',
            background: placedCount > 0 ? 'rgba(45,212,160,0.1)' : '#1a1a2e',
            border: placedCount > 0 ? '1px solid #2dd4a0' : '1px solid #252540',
            borderRadius: 8, color: placedCount > 0 ? '#2dd4a0' : '#333355',
            fontSize: 13, fontWeight: 600, cursor: placedCount > 0 ? 'pointer' : 'default',
            fontFamily: font,
          },
        }, `Apply Auto-Pack (${placedCount} shapes)`),
      ),
    ),
  );
}
