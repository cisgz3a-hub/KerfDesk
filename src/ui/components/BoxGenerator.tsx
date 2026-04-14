import React, { useState, useRef, useEffect } from 'react';
import { generateId } from '../../core/types';
import { NumberInput } from './NumberInput';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';

interface BoxGeneratorProps {
  scene: Scene;
  onGenerate: (objects: SceneObject[]) => void;
  onClose: () => void;
}

export function BoxGenerator({ scene, onGenerate, onClose }: BoxGeneratorProps) {
  const [width, setWidth] = useState(80);
  const [height, setHeight] = useState(50);
  const [depth, setDepth] = useState(40);
  const [thickness, setThickness] = useState(3);
  const [fingerWidth, setFingerWidth] = useState(10);
  const [openTop, setOpenTop] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  // Generate all box faces as polygon point arrays
  function generateBoxFaces() {
    const t = thickness;
    const fw = fingerWidth;
    const spacing = thickness * 2 + 5; // Account for finger tab protrusions + gap

    const faces: Array<{
      name: string;
      points: Array<{ x: number; y: number }>;
      offsetX: number;
      offsetY: number;
    }> = [];

    // Row 1: Front, Back (width x height)
    faces.push({
      name: 'Front',
      points: generateRectWithFingers(width, height, t, fw, true, true, true, true),
      offsetX: t,
      offsetY: t,
    });

    faces.push({
      name: 'Back',
      points: generateRectWithFingers(width, height, t, fw, true, true, true, true),
      offsetX: width + spacing + t,
      offsetY: t,
    });

    // Row 2: Left, Right (depth x height)
    const row2Y = height + spacing + t;

    faces.push({
      name: 'Left',
      points: generateRectWithFingers(depth, height, t, fw, false, false, true, true),
      offsetX: t,
      offsetY: row2Y,
    });

    faces.push({
      name: 'Right',
      points: generateRectWithFingers(depth, height, t, fw, false, false, true, true),
      offsetX: depth + spacing + t,
      offsetY: row2Y,
    });

    // Row 3: Bottom, Top (width x depth)
    const row3Y = row2Y + height + spacing + t;

    faces.push({
      name: 'Bottom',
      points: generateRectWithFingers(width, depth, t, fw, false, false, false, false),
      offsetX: t,
      offsetY: row3Y,
    });

    if (!openTop) {
      faces.push({
        name: 'Top',
        points: generateRectWithFingers(width, depth, t, fw, false, false, false, false),
        offsetX: width + spacing + t,
        offsetY: row3Y,
      });
    }

    return faces;
  }

  // Generate a rectangle with finger joints on each edge
  function generateRectWithFingers(
    w: number,
    h: number,
    t: number,
    fw: number,
    topFingers: boolean,
    bottomFingers: boolean,
    leftFingers: boolean,
    rightFingers: boolean
  ): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];

    const countW = Math.max(1, Math.round(w / fw)) | 1; // Force odd for symmetry
    const countH = Math.max(1, Math.round(h / fw)) | 1;
    const segW = w / countW;
    const segH = h / countH;

    // Top edge: left to right
    for (let i = 0; i < countW; i++) {
      const x1 = i * segW;
      const x2 = (i + 1) * segW;
      if (topFingers && i % 2 === 0) {
        points.push({ x: x1, y: 0 });
        points.push({ x: x1, y: -t });
        points.push({ x: x2, y: -t });
        points.push({ x: x2, y: 0 });
      } else {
        points.push({ x: x1, y: 0 });
        points.push({ x: x2, y: 0 });
      }
    }

    // Right edge: top to bottom
    for (let i = 0; i < countH; i++) {
      const y1 = i * segH;
      const y2 = (i + 1) * segH;
      if (rightFingers && i % 2 === 0) {
        points.push({ x: w, y: y1 });
        points.push({ x: w + t, y: y1 });
        points.push({ x: w + t, y: y2 });
        points.push({ x: w, y: y2 });
      } else {
        points.push({ x: w, y: y1 });
        points.push({ x: w, y: y2 });
      }
    }

    // Bottom edge: right to left
    for (let i = countW - 1; i >= 0; i--) {
      const x1 = i * segW;
      const x2 = (i + 1) * segW;
      if (bottomFingers && i % 2 === 0) {
        points.push({ x: x2, y: h });
        points.push({ x: x2, y: h + t });
        points.push({ x: x1, y: h + t });
        points.push({ x: x1, y: h });
      } else {
        points.push({ x: x2, y: h });
        points.push({ x: x1, y: h });
      }
    }

    // Left edge: bottom to top
    for (let i = countH - 1; i >= 0; i--) {
      const y1 = i * segH;
      const y2 = (i + 1) * segH;
      if (leftFingers && i % 2 === 0) {
        points.push({ x: 0, y: y2 });
        points.push({ x: -t, y: y2 });
        points.push({ x: -t, y: y1 });
        points.push({ x: 0, y: y1 });
      } else {
        points.push({ x: 0, y: y2 });
        points.push({ x: 0, y: y1 });
      }
    }

    // Remove duplicate consecutive points
    const cleaned: Array<{ x: number; y: number }> = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = cleaned[cleaned.length - 1];
      if (Math.abs(points[i].x - prev.x) > 0.001 || Math.abs(points[i].y - prev.y) > 0.001) {
        cleaned.push(points[i]);
      }
    }

    return cleaned;
  }

  // Preview render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const logicalW = 340;
    const logicalH = 340;
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = '100%';
    canvas.style.height = `${logicalH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cw = logicalW;
    const ch = logicalH;
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, cw, ch);

    const faces = generateBoxFaces();
    if (faces.length === 0) return;

    // Find total bounds
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const face of faces) {
      for (const p of face.points) {
        minX = Math.min(minX, p.x + face.offsetX);
        minY = Math.min(minY, p.y + face.offsetY);
        maxX = Math.max(maxX, p.x + face.offsetX);
        maxY = Math.max(maxY, p.y + face.offsetY);
      }
    }

    const rangeX = (maxX - minX) || 1;
    const rangeY = (maxY - minY) || 1;
    const padding = 20;
    const scale = Math.min((cw - padding * 2) / rangeX, (ch - padding * 2) / rangeY);
    const ox = (cw - rangeX * scale) / 2 - minX * scale;
    const oy = (ch - rangeY * scale) / 2 - minY * scale;

    // Draw each face
    for (const face of faces) {
      ctx.beginPath();
      const pts = face.points;
      if (pts.length === 0) continue;
      ctx.moveTo((pts[0].x + face.offsetX) * scale + ox, (pts[0].y + face.offsetY) * scale + oy);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo((pts[i].x + face.offsetX) * scale + ox, (pts[i].y + face.offsetY) * scale + oy);
      }
      ctx.closePath();
      ctx.strokeStyle = '#ff4466';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label
      const cx = face.offsetX + (face.name === 'Front' || face.name === 'Back' ? width / 2 : depth / 2);
      const cy = face.offsetY + (face.name === 'Bottom' || face.name === 'Top' ? depth / 2 : height / 2);
      ctx.fillStyle = '#555570';
      ctx.font = `${Math.max(8, Math.min(12, scale * 5))}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(face.name, cx * scale + ox, cy * scale + oy);
    }
  }, [width, height, depth, thickness, fingerWidth, openTop]);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
    color: '#e0e0ec', fontSize: 12, outline: 'none',
    fontFamily: mono,
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
        width: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); },
    },
      // Header
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Box Generator'),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' } }, '×'),
      ),

      // Content
      React.createElement('div', { style: { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 } },
        // Left: inputs
        React.createElement('div', { style: { width: 200, padding: '16px', borderRight: '1px solid #1a1a2e', overflowY: 'auto' as const } },
          ...[
            { key: 'width', label: 'Width (mm)', value: width, set: setWidth, min: 10, max: 500 },
            { key: 'height', label: 'Height (mm)', value: height, set: setHeight, min: 10, max: 500 },
            { key: 'depth', label: 'Depth (mm)', value: depth, set: setDepth, min: 10, max: 500 },
            { key: 'thickness', label: 'Material (mm)', value: thickness, set: setThickness, min: 1, max: 20 },
            { key: 'fingerWidth', label: 'Finger width', value: fingerWidth, set: setFingerWidth, min: 3, max: 50 },
          ].map(f =>
            React.createElement('div', { key: f.key, style: { marginBottom: 10 } },
              React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, f.label),
              React.createElement(NumberInput, {
                value: f.value,
                min: f.min,
                max: f.max,
                defaultValue: f.value,
                style: inputStyle,
                onChange: (v: number) => f.set(v),
                onCommit: (v: number) => f.set(v),
              }),
            ),
          ),
          // Open top toggle
          React.createElement('div', { style: { marginBottom: 12 } },
            React.createElement('button', {
              onClick: () => setOpenTop(!openTop),
              style: {
                width: '100%', padding: '6px',
                background: openTop ? 'rgba(0,212,255,0.1)' : '#0a0a14',
                border: openTop ? '1px solid #00d4ff' : '1px solid #252540',
                borderRadius: 6, color: openTop ? '#00d4ff' : '#555570',
                fontSize: 11, cursor: 'pointer', fontFamily: font,
              },
            }, openTop ? '☐ Open top' : '☑ Closed top'),
          ),
          // Info
          React.createElement('div', { style: { fontSize: 9, color: '#444460', lineHeight: 1.5 } },
            `${openTop ? 5 : 6} faces`, React.createElement('br'),
            `Material: ${thickness}mm`, React.createElement('br'),
            `~${Math.round((width * 2 + depth * 2) * (height + depth) / 1000)}cm² material`,
          ),
        ),

        // Right: preview
        React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0 } },
          React.createElement('canvas', {
            ref: canvasRef,
            style: { width: '100%', flex: 1, background: '#08080f', minHeight: 200 },
          }),
        ),
      ),

      // Generate button
      React.createElement('div', { style: { padding: '12px 18px', borderTop: '1px solid #1a1a2e', flexShrink: 0 } },
        React.createElement('button', {
          onClick: () => {
            const layerId = scene.activeLayerId || scene.layers[0]?.id;
            if (!layerId) return;
            const faces = generateBoxFaces();
            const objects: SceneObject[] = faces.map(face => ({
              id: generateId(),
              type: 'polygon' as const,
              name: `Box: ${face.name}`,
              layerId,
              parentId: null,
              transform: {
                a: 1, b: 0, c: 0, d: 1,
                tx: face.offsetX + 20,
                ty: face.offsetY + 20,
              },
              geometry: {
                type: 'polygon' as const,
                points: face.points,
                closed: true,
              },
              visible: true,
              locked: false,
              powerScale: 1.0,
              _bounds: null,
              _worldTransform: null,
            }));
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
        }, `Generate ${openTop ? 5 : 6}-Face Box`),
      ),
    ),
  );
}
