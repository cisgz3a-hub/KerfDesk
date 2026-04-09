import React, { useState, useCallback } from 'react';

interface BoxGeneratorProps {
  onGenerate: (svg: string, name: string) => void;
  onClose: () => void;
}

export function BoxGenerator({ onGenerate, onClose }: BoxGeneratorProps) {
  const [width, setWidth] = useState(80);
  const [height, setHeight] = useState(50);
  const [depth, setDepth] = useState(40);
  const [thickness, setThickness] = useState(3);
  const [fingerWidth, setFingerWidth] = useState(10);
  const [openTop, setOpenTop] = useState(false);
  const [hoveredPanel, setHoveredPanel] = useState<string | null>(null);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  // ─── Generate finger-joint box SVG ────────────────────
  const generateBox = useCallback(() => {
    const t = thickness;
    const fw = fingerWidth;

    // Calculate finger counts for each edge
    const fingersW = Math.max(1, Math.floor(width / fw));
    const fingersH = Math.max(1, Math.floor(height / fw));

    // Actual finger width adjusted to fill edge evenly
    const fwW = width / fingersW;
    const fwH = height / fingersH;

    const panels: string[] = [];
    let offsetX = 5;
    let offsetY = 5;
    const gap = 5;

    // Helper: generate a simple rect with finger joints on specified edges
    function panelRect(
      px: number, py: number,
      pw: number, ph: number,
      label: string
    ): string {
      return `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="none" stroke="red" stroke-width="0.2"/>
        <text x="${px + pw/2}" y="${py + ph/2}" text-anchor="middle" dominant-baseline="middle" font-size="3" fill="#666" font-family="sans-serif">${label}</text>`;
    }

    // Simple box layout: all 6 faces as rectangles (finger joints as visual markers)
    // Front face
    panels.push(panelRect(offsetX, offsetY, width, height, 'Front'));
    // Add finger notches on bottom edge
    for (let i = 0; i < fingersW; i++) {
      if (i % 2 === 0) {
        panels.push(`<rect x="${offsetX + i * fwW}" y="${offsetY + height}" width="${fwW}" height="${t}" fill="none" stroke="red" stroke-width="0.2"/>`);
      }
    }
    // Add finger notches on top edge (if not open)
    if (!openTop) {
      for (let i = 0; i < fingersW; i++) {
        if (i % 2 === 0) {
          panels.push(`<rect x="${offsetX + i * fwW}" y="${offsetY - t}" width="${fwW}" height="${t}" fill="none" stroke="red" stroke-width="0.2"/>`);
        }
      }
    }
    // Side notches
    for (let i = 0; i < fingersH; i++) {
      if (i % 2 === 0) {
        panels.push(`<rect x="${offsetX - t}" y="${offsetY + i * fwH}" width="${t}" height="${fwH}" fill="none" stroke="red" stroke-width="0.2"/>`);
        panels.push(`<rect x="${offsetX + width}" y="${offsetY + i * fwH}" width="${t}" height="${fwH}" fill="none" stroke="red" stroke-width="0.2"/>`);
      }
    }

    const frontH = height + (openTop ? 0 : t) + t;
    offsetY += frontH + gap;

    // Back face
    panels.push(panelRect(offsetX, offsetY, width, height, 'Back'));
    for (let i = 0; i < fingersW; i++) {
      if (i % 2 === 0) {
        panels.push(`<rect x="${offsetX + i * fwW}" y="${offsetY + height}" width="${fwW}" height="${t}" fill="none" stroke="red" stroke-width="0.2"/>`);
      }
    }
    if (!openTop) {
      for (let i = 0; i < fingersW; i++) {
        if (i % 2 === 0) {
          panels.push(`<rect x="${offsetX + i * fwW}" y="${offsetY - t}" width="${fwW}" height="${t}" fill="none" stroke="red" stroke-width="0.2"/>`);
        }
      }
    }
    for (let i = 0; i < fingersH; i++) {
      if (i % 2 === 0) {
        panels.push(`<rect x="${offsetX - t}" y="${offsetY + i * fwH}" width="${t}" height="${fwH}" fill="none" stroke="red" stroke-width="0.2"/>`);
        panels.push(`<rect x="${offsetX + width}" y="${offsetY + i * fwH}" width="${t}" height="${fwH}" fill="none" stroke="red" stroke-width="0.2"/>`);
      }
    }

    offsetY += frontH + gap;

    // Left side
    panels.push(panelRect(offsetX, offsetY, depth, height, 'Left'));
    for (let i = 0; i < fingersH; i++) {
      if (i % 2 === 1) {
        panels.push(`<rect x="${offsetX - t}" y="${offsetY + i * fwH}" width="${t}" height="${fwH}" fill="none" stroke="red" stroke-width="0.2"/>`);
        panels.push(`<rect x="${offsetX + depth}" y="${offsetY + i * fwH}" width="${t}" height="${fwH}" fill="none" stroke="red" stroke-width="0.2"/>`);
      }
    }

    offsetY += height + gap;

    // Right side
    panels.push(panelRect(offsetX, offsetY, depth, height, 'Right'));
    for (let i = 0; i < fingersH; i++) {
      if (i % 2 === 1) {
        panels.push(`<rect x="${offsetX - t}" y="${offsetY + i * fwH}" width="${t}" height="${fwH}" fill="none" stroke="red" stroke-width="0.2"/>`);
        panels.push(`<rect x="${offsetX + depth}" y="${offsetY + i * fwH}" width="${t}" height="${fwH}" fill="none" stroke="red" stroke-width="0.2"/>`);
      }
    }

    offsetY += height + gap;

    // Bottom
    panels.push(panelRect(offsetX, offsetY, width, depth, 'Bottom'));
    for (let i = 0; i < fingersW; i++) {
      if (i % 2 === 1) {
        panels.push(`<rect x="${offsetX + i * fwW}" y="${offsetY - t}" width="${fwW}" height="${t}" fill="none" stroke="red" stroke-width="0.2"/>`);
        panels.push(`<rect x="${offsetX + i * fwW}" y="${offsetY + depth}" width="${fwW}" height="${t}" fill="none" stroke="red" stroke-width="0.2"/>`);
      }
    }

    offsetY += depth + gap;

    // Top (if not open)
    if (!openTop) {
      panels.push(panelRect(offsetX, offsetY, width, depth, 'Top'));
      for (let i = 0; i < fingersW; i++) {
        if (i % 2 === 1) {
          panels.push(`<rect x="${offsetX + i * fwW}" y="${offsetY - t}" width="${fwW}" height="${t}" fill="none" stroke="red" stroke-width="0.2"/>`);
          panels.push(`<rect x="${offsetX + i * fwW}" y="${offsetY + depth}" width="${fwW}" height="${t}" fill="none" stroke="red" stroke-width="0.2"/>`);
        }
      }
      offsetY += depth + gap;
    }

    const totalW = Math.max(width, depth) + t * 2 + 10;
    const totalH = offsetY + 5;

    const svg = `<svg viewBox="0 0 ${totalW} ${totalH}" width="${totalW}mm" height="${totalH}mm" xmlns="http://www.w3.org/2000/svg">
      ${panels.join('\n      ')}
    </svg>`;

    onGenerate(svg, `Box ${width}×${depth}×${height}mm`);
  }, [width, height, depth, thickness, fingerWidth, openTop, onGenerate]);

  // ─── Styles ─────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px',
    background: '#0a0a14', border: '1px solid #252540', borderRadius: 6,
    color: '#e0e0ec', fontSize: 13, fontFamily: mono, outline: 'none',
    textAlign: 'right' as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#8888aa', marginBottom: 3,
  };

  // ─── 3D Preview ─────────────────────────────────────────
  const previewScale = 1.5;
  const pW = width * previewScale;
  const pH = height * previewScale;
  const pD = depth * previewScale * 0.5;
  const isoX = pD * 0.7;
  const isoY = pD * 0.4;

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
        width: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: { padding: '16px 20px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('span', { style: { color: '#e0e0ec', fontSize: 16, fontWeight: 700 } }, 'Box Generator'),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 20, cursor: 'pointer' },
        }, '×'),
      ),

      // 3D Preview
      React.createElement('div', {
        style: {
          height: 180, background: '#08080f', display: 'flex',
          alignItems: 'center', justifyContent: 'center', position: 'relative' as const,
        },
      },
        React.createElement('svg', {
          viewBox: `0 0 ${pW + isoX + 40} ${pH + isoY + 40}`,
          style: { maxHeight: 160, maxWidth: '90%' },
        },
          // Front face
          React.createElement('polygon', {
            points: `20,${isoY + 20} ${20 + pW},${isoY + 20} ${20 + pW},${isoY + 20 + pH} 20,${isoY + 20 + pH}`,
            fill: hoveredPanel === 'front' ? 'rgba(255,68,102,0.15)' : 'rgba(255,68,102,0.08)',
            stroke: '#ff4466', strokeWidth: 1,
            onMouseEnter: () => setHoveredPanel('front'),
            onMouseLeave: () => setHoveredPanel(null),
          }),
          // Top face
          !openTop && React.createElement('polygon', {
            points: `20,${isoY + 20} ${20 + isoX},20 ${20 + pW + isoX},20 ${20 + pW},${isoY + 20}`,
            fill: hoveredPanel === 'top' ? 'rgba(0,212,255,0.15)' : 'rgba(0,212,255,0.08)',
            stroke: '#00d4ff', strokeWidth: 1,
            onMouseEnter: () => setHoveredPanel('top'),
            onMouseLeave: () => setHoveredPanel(null),
          }),
          // Right face
          React.createElement('polygon', {
            points: `${20 + pW},${isoY + 20} ${20 + pW + isoX},20 ${20 + pW + isoX},${20 + pH} ${20 + pW},${isoY + 20 + pH}`,
            fill: hoveredPanel === 'right' ? 'rgba(45,212,160,0.15)' : 'rgba(45,212,160,0.08)',
            stroke: '#2dd4a0', strokeWidth: 1,
            onMouseEnter: () => setHoveredPanel('right'),
            onMouseLeave: () => setHoveredPanel(null),
          }),
          // Dimension labels
          React.createElement('text', {
            x: 20 + pW / 2, y: isoY + 20 + pH + 14,
            textAnchor: 'middle', fontSize: 10, fill: '#8888aa',
          }, `${width}mm`),
          React.createElement('text', {
            x: 10, y: isoY + 20 + pH / 2,
            textAnchor: 'middle', fontSize: 10, fill: '#8888aa',
            transform: `rotate(-90, 10, ${isoY + 20 + pH / 2})`,
          }, `${height}mm`),
          React.createElement('text', {
            x: 20 + pW + isoX / 2 + 4, y: isoY / 2 + 12,
            textAnchor: 'middle', fontSize: 10, fill: '#8888aa',
          }, `${depth}mm`),
        ),
      ),

      // Controls
      React.createElement('div', {
        style: { padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
      },
        // Width
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, 'Width (mm)'),
          React.createElement('input', {
            type: 'number', value: width, min: 10, max: 500,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWidth(parseInt(e.target.value) || 10),
            onBlur: () => setWidth(Math.max(10, Math.min(500, width))),
            style: inputStyle,
          }),
        ),
        // Depth
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, 'Depth (mm)'),
          React.createElement('input', {
            type: 'number', value: depth, min: 10, max: 500,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDepth(parseInt(e.target.value) || 10),
            onBlur: () => setDepth(Math.max(10, Math.min(500, depth))),
            style: inputStyle,
          }),
        ),
        // Height
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, 'Height (mm)'),
          React.createElement('input', {
            type: 'number', value: height, min: 10, max: 500,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setHeight(parseInt(e.target.value) || 10),
            onBlur: () => setHeight(Math.max(10, Math.min(500, height))),
            style: inputStyle,
          }),
        ),
        // Material thickness
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, 'Material (mm)'),
          React.createElement('input', {
            type: 'number', value: thickness, min: 1, max: 20, step: 0.5,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setThickness(parseFloat(e.target.value) || 3),
            onBlur: () => setThickness(Math.max(1, Math.min(20, thickness))),
            style: inputStyle,
          }),
        ),
        // Finger width
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, 'Finger (mm)'),
          React.createElement('input', {
            type: 'number', value: fingerWidth, min: 3, max: 50,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFingerWidth(parseInt(e.target.value) || 10),
            onBlur: () => setFingerWidth(Math.max(3, Math.min(50, fingerWidth))),
            style: inputStyle,
          }),
        ),
        // Open top toggle
        React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end' } },
          React.createElement('button', {
            onClick: () => setOpenTop(!openTop),
            style: {
              width: '100%', padding: '6px 10px', fontSize: 12, cursor: 'pointer',
              background: openTop ? 'rgba(0,212,255,0.1)' : 'rgba(255,255,255,0.03)',
              border: openTop ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 6, fontFamily: font,
              color: openTop ? '#00d4ff' : '#8888aa',
            },
          }, openTop ? '☐ Open top' : '☑ Closed top'),
        ),
      ),

      // Info line
      React.createElement('div', {
        style: { padding: '0 20px 8px', fontSize: 10, color: '#555570' },
      }, `${openTop ? 5 : 6} panels · ${Math.ceil((2*(width*height + width*depth + depth*height)) / 100)} cm² material`),

      // Generate button
      React.createElement('div', { style: { padding: '12px 20px' } },
        React.createElement('button', {
          onClick: generateBox,
          style: {
            width: '100%', padding: '12px',
            background: 'rgba(45,212,160,0.1)', border: '1px solid #2dd4a0',
            borderRadius: 8, color: '#2dd4a0', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: font,
          },
        }, 'Generate Box'),
      ),
    ),
  );
}
