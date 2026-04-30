import React, { useState, useRef, useEffect } from 'react';
import { generateId } from '../../core/types';
import { NumberInput } from './NumberInput';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { generateBoxFaces, interiorToExterior, exteriorToInterior, computeBoxJointMetrics } from '../../core/box/boxGeometry';
import { KERF_PRESETS, findPresetIdForKerf } from '../../core/box/kerfPresets';
import { BOX_LIBRARY_PRESETS, formatBoxLibraryCategory, getBoxLibraryPreset } from '../../core/box/boxLibrary';

interface BoxGeneratorProps {
  scene: Scene;
  onGenerate: (objects: SceneObject[]) => void;
  onClose: () => void;
}

const BOX_KERF_STORAGE_KEY = 'laserforge_box_kerf_mm';
const BOX_FIT_ALLOWANCE_STORAGE_KEY = 'laserforge_box_fit_allowance_mm';

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage may be unavailable in privacy mode; the generator still works.
  }
}

export function BoxGenerator({ scene, onGenerate, onClose }: BoxGeneratorProps) {
  const [width, setWidth] = useState(80);
  const [height, setHeight] = useState(50);
  const [depth, setDepth] = useState(40);
  const [thickness, setThickness] = useState(3);
  const [fingerWidth, setFingerWidth] = useState(10);
  const [kerf, setKerf] = useState(() => readStoredNumber(BOX_KERF_STORAGE_KEY, 0.1));
  const [fitAllowance, setFitAllowance] = useState(() => readStoredNumber(BOX_FIT_ALLOWANCE_STORAGE_KEY, 0.03));
  const [openTop, setOpenTop] = useState(false);
  const [dimensionMode, setDimensionMode] = useState<'outside' | 'inside'>('outside');
  const [selectedPresetId, setSelectedPresetId] = useState('starter-small-closed');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const selectedPreset = getBoxLibraryPreset(selectedPresetId);
  const resolved = dimensionMode === 'inside'
    ? interiorToExterior(width, height, depth, thickness, openTop)
    : { width, height, depth };
  const cavity = dimensionMode === 'outside'
    ? exteriorToInterior(width, height, depth, thickness, openTop)
    : { width, height, depth };
  const jointMetrics = computeBoxJointMetrics(thickness, kerf, fitAllowance);

  const applyPreset = (presetId: string): void => {
    const preset = getBoxLibraryPreset(presetId);
    if (!preset) return;
    setSelectedPresetId(preset.id);
    setDimensionMode(preset.dimensionMode);
    setWidth(preset.width);
    setHeight(preset.height);
    setDepth(preset.depth);
    setThickness(preset.thickness);
    setFingerWidth(preset.fingerWidth);
    setKerf(preset.kerf);
    setFitAllowance(preset.fitAllowance);
    setOpenTop(preset.openTop);
  };

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  useEffect(() => { writeStoredNumber(BOX_KERF_STORAGE_KEY, kerf); }, [kerf]);
  useEffect(() => { writeStoredNumber(BOX_FIT_ALLOWANCE_STORAGE_KEY, fitAllowance); }, [fitAllowance]);

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

    const faces = generateBoxFaces({
      width: resolved.width,
      height: resolved.height,
      depth: resolved.depth,
      thickness,
      fingerWidth,
      openTop,
      kerf,
      fitAllowance,
    });
    if (faces.length === 0) return;

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
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const cx = face.offsetX + (face.name === 'Front' || face.name === 'Back' ? resolved.width / 2 : resolved.depth / 2);
      const cy = face.offsetY + (face.name === 'Bottom' || face.name === 'Top' ? resolved.depth / 2 : resolved.height / 2);
      ctx.fillStyle = '#555570';
      ctx.font = `${Math.max(8, Math.min(12, scale * 5))}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(face.name, cx * scale + ox, cy * scale + oy);
    }
  }, [
    width,
    height,
    depth,
    resolved.width,
    resolved.height,
    resolved.depth,
    thickness,
    fingerWidth,
    openTop,
    kerf,
    fitAllowance,
    dimensionMode,
  ]);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    background: '#0a0a14',
    border: '1px solid #252540',
    borderRadius: 6,
    color: '#e0e0ec',
    fontSize: 12,
    outline: 'none',
    fontFamily: mono,
  };

  const materialAreaCm2 = Math.round(
    ((resolved.width * resolved.height * 2)
      + (resolved.depth * resolved.height * 2)
      + (resolved.width * resolved.depth * (openTop ? 1 : 2))) / 100,
  );

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
        width: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); },
    },
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Box Generator'),
          React.createElement('div', { style: { fontSize: 10, color: '#7a7a95', marginTop: 2 } },
            dimensionMode === 'inside'
              ? 'Type the cavity you need - we\'ll add walls.'
              : 'Type the overall box size you want.',
          ),
        ),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' } }, 'x'),
      ),

      React.createElement('div', { style: { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 } },
        React.createElement('div', { style: { width: 260, padding: '16px', borderRight: '1px solid #1a1a2e', overflowY: 'auto' as const } },
          React.createElement('div', { key: 'library', style: { marginBottom: 14 } },
            React.createElement('div', {
              style: { fontSize: 11, color: '#9090b0', marginBottom: 8, fontWeight: 500 },
            }, 'Box library'),
            React.createElement('select', {
              value: selectedPresetId,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                const id = e.target.value;
                setSelectedPresetId(id);
                applyPreset(id);
              },
              style: {
                ...inputStyle,
                marginBottom: 6,
                cursor: 'pointer',
              },
            },
              ...BOX_LIBRARY_PRESETS.map(preset =>
                React.createElement('option', { key: preset.id, value: preset.id },
                  `${formatBoxLibraryCategory(preset.category)} — ${preset.title}`,
                ),
              ),
            ),
            selectedPreset
              ? React.createElement('div', {
                  style: {
                    fontSize: 9, color: '#7a7a95', lineHeight: 1.4,
                    background: '#0a0a14', border: '1px solid #202038',
                    borderRadius: 6, padding: '8px 9px',
                  },
                }, selectedPreset.description)
              : null,
          ),
          // Dimension mode is framed as a concrete project goal instead of
          // an abstract outside/inside choice. First-time users tend to know
          // whether they want a finished box size or a cavity that fits an
          // object, even if they do not yet think in exterior-vs-interior
          // measurement terms.
          React.createElement('div', { key: 'dimMode', style: { marginBottom: 14 } },
            React.createElement('div', {
              style: { fontSize: 11, color: '#9090b0', marginBottom: 8, fontWeight: 500 },
            }, 'What\'s your goal?'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
              React.createElement('button', {
                type: 'button',
                onClick: () => setDimensionMode('outside'),
                title: 'You type the box exterior dimensions. Useful when the overall finished size matters.',
                style: {
                  textAlign: 'left' as const, padding: '10px 12px', fontSize: 11,
                  background: dimensionMode === 'outside' ? 'rgba(0,212,255,0.10)' : '#0a0a14',
                  border: dimensionMode === 'outside' ? '1px solid #00d4ff' : '1px solid #252540',
                  borderRadius: 6,
                  color: dimensionMode === 'outside' ? '#d0e8ff' : '#9a9ab5',
                  cursor: 'pointer', fontFamily: font, lineHeight: 1.3,
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                },
              },
                React.createElement('div', {
                  style: {
                    fontSize: 18, lineHeight: 1, marginTop: 1,
                    opacity: dimensionMode === 'outside' ? 1 : 0.55,
                  },
                }, '📦'),
                React.createElement('div', { style: { flex: 1 } },
                  React.createElement('div', {
                    style: {
                      fontWeight: 600,
                      color: dimensionMode === 'outside' ? '#00d4ff' : '#c0c0d8',
                      marginBottom: 2,
                    },
                  }, 'Make a box at a specific size'),
                  React.createElement('div', { style: { fontSize: 10, opacity: 0.75 } },
                    'I know how big I want the finished box. I\'ll type its outside dimensions.',
                  ),
                ),
              ),
              React.createElement('button', {
                type: 'button',
                onClick: () => setDimensionMode('inside'),
                title: 'You type the cavity dimensions; LaserForge adds wall thickness to get the exterior.',
                style: {
                  textAlign: 'left' as const, padding: '10px 12px', fontSize: 11,
                  background: dimensionMode === 'inside' ? 'rgba(0,212,255,0.10)' : '#0a0a14',
                  border: dimensionMode === 'inside' ? '1px solid #00d4ff' : '1px solid #252540',
                  borderRadius: 6,
                  color: dimensionMode === 'inside' ? '#d0e8ff' : '#9a9ab5',
                  cursor: 'pointer', fontFamily: font, lineHeight: 1.3,
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                },
              },
                React.createElement('div', {
                  style: {
                    fontSize: 18, lineHeight: 1, marginTop: 1,
                    opacity: dimensionMode === 'inside' ? 1 : 0.55,
                  },
                }, '📐'),
                React.createElement('div', { style: { flex: 1 } },
                  React.createElement('div', {
                    style: {
                      fontWeight: 600,
                      color: dimensionMode === 'inside' ? '#00d4ff' : '#c0c0d8',
                      marginBottom: 2,
                    },
                  }, 'Fit something inside'),
                  React.createElement('div', { style: { fontSize: 10, opacity: 0.75 } },
                    'I have something that needs to fit. I\'ll type the inside cavity dimensions.',
                  ),
                ),
              ),
            ),
          ),
          // Field labels are explicit so a user looking at one field still
          // knows whether the value is exterior or cavity size.
          ...[
            { key: 'width', label: dimensionMode === 'inside' ? 'Cavity width (mm)' : 'Outer width (mm)', value: width, set: setWidth, min: 10, max: 500, step: 1 },
            { key: 'height', label: dimensionMode === 'inside' ? 'Cavity height (mm)' : 'Outer height (mm)', value: height, set: setHeight, min: 10, max: 500, step: 1 },
            { key: 'depth', label: dimensionMode === 'inside' ? 'Cavity depth (mm)' : 'Outer depth (mm)', value: depth, set: setDepth, min: 10, max: 500, step: 1 },
            { key: 'thickness', label: 'Material thickness (mm)', value: thickness, set: setThickness, min: 1, max: 20, step: 0.1 },
            { key: 'fingerWidth', label: 'Finger width (mm)', value: fingerWidth, set: setFingerWidth, min: 3, max: 50, step: 1 },
          ].map(f =>
            React.createElement('div', { key: f.key, style: { marginBottom: 10 } },
              React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, f.label),
              React.createElement(NumberInput, {
                value: f.value,
                min: f.min,
                max: f.max,
                step: f.step,
                defaultValue: f.value,
                style: inputStyle,
                onChange: (v: number) => f.set(v),
                onCommit: (v: number) => f.set(v),
              }),
            ),
          ),
          React.createElement('div', { key: 'kerf', style: { marginBottom: 10 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Kerf preset'),
            React.createElement('select', {
              value: findPresetIdForKerf(kerf),
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                const id = e.target.value;
                if (id === 'custom') return;
                const preset = KERF_PRESETS.find(p => p.id === id);
                if (preset) setKerf(preset.kerf);
              },
              style: {
                ...inputStyle,
                marginBottom: 6,
                cursor: 'pointer',
              },
            },
              ...KERF_PRESETS.map(p =>
                React.createElement('option', { key: p.id, value: p.id }, p.label),
              ),
            ),
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Kerf (mm)'),
            React.createElement(NumberInput, {
              value: kerf,
              min: 0,
              max: 1,
              step: 0.05,
              defaultValue: kerf,
              style: inputStyle,
              onChange: (v: number) => setKerf(v),
              onCommit: (v: number) => setKerf(v),
            }),
          ),
          React.createElement('div', { key: 'fitAllowance', style: { marginBottom: 10 } },
            React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 3 } }, 'Fit allowance (mm)'),
            React.createElement(NumberInput, {
              value: fitAllowance,
              min: 0,
              max: 0.5,
              step: 0.01,
              defaultValue: fitAllowance,
              style: inputStyle,
              onChange: (v: number) => setFitAllowance(v),
              onCommit: (v: number) => setFitAllowance(v),
            }),
            React.createElement('div', { style: { fontSize: 9, color: '#666680', lineHeight: 1.4, marginTop: 4 } },
              `Expected joint clearance ≈ ${jointMetrics.expectedWidthClearance.toFixed(2)}mm. Tab/slot depth is kerf-corrected to ${jointMetrics.physicalTabDepth.toFixed(2)}mm material thickness.`,
            ),
          ),
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
            }, openTop ? '☑ Open top (no lid)' : '☐ Open top (no lid)'),
            openTop && dimensionMode === 'inside'
              ? React.createElement('div', {
                  style: {
                    fontSize: 9, color: '#7a7a95', marginTop: 4,
                    fontStyle: 'italic' as const, lineHeight: 1.4,
                  },
                }, 'Open-top: cavity height adds only the floor (1 thickness), not floor + lid (2).')
              : null,
          ),
          // Asymmetric by design: in inside mode the derived exterior is
          // critical because it determines whether the cut fits the material.
          // In outside mode the derived cavity is useful but secondary.
          dimensionMode === 'inside'
            ? React.createElement('div', {
                style: {
                  padding: '12px 14px',
                  marginBottom: 8,
                  background: 'rgba(0,212,255,0.10)',
                  border: '1px solid rgba(0,212,255,0.4)',
                  borderRadius: 6,
                  lineHeight: 1.4,
                },
              },
                React.createElement('div', {
                  style: {
                    fontSize: 9, color: '#8eb8d0',
                    textTransform: 'uppercase' as const, letterSpacing: 0.6,
                    marginBottom: 4, fontWeight: 600,
                  },
                }, 'Box will be cut at'),
                React.createElement('div', {
                  style: {
                    fontSize: 16, fontWeight: 700, fontFamily: mono,
                    color: '#6db8ff', letterSpacing: 0.3,
                  },
                }, `${resolved.width} × ${resolved.height} × ${resolved.depth} mm`),
                React.createElement('div', {
                  style: { fontSize: 9, color: '#7a90a8', marginTop: 4, fontStyle: 'italic' as const },
                }, 'Make sure your material is at least this big.'),
              )
            : React.createElement('div', {
                style: {
                  fontSize: 10, color: '#7a8a78', marginBottom: 6, lineHeight: 1.4,
                  fontStyle: 'italic' as const,
                },
              },
                'Inside cavity will be ',
                React.createElement('span', {
                  style: { fontFamily: mono, color: '#9dc8a8', fontStyle: 'normal' as const },
                }, `${cavity.width} × ${cavity.height} × ${cavity.depth} mm`),
                '.',
            ),
          React.createElement('div', { style: { fontSize: 9, color: '#666680', lineHeight: 1.6 } },
            `${openTop ? 5 : 6} faces · ${thickness}mm material · ${kerf}mm kerf · ${fitAllowance}mm fit · ~${materialAreaCm2}cm²`,
          ),
        ),

        React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0 } },
          React.createElement('canvas', {
            ref: canvasRef,
            style: { width: '100%', flex: 1, background: '#08080f', minHeight: 200 },
          }),
        ),
      ),

      React.createElement('div', { style: { padding: '12px 18px', borderTop: '1px solid #1a1a2e', flexShrink: 0 } },
        React.createElement('button', {
          onClick: () => {
            const layerId = scene.activeLayerId || scene.layers[0]?.id;
            if (!layerId) return;
            const faces = generateBoxFaces({
              width: resolved.width,
              height: resolved.height,
              depth: resolved.depth,
              thickness,
              fingerWidth,
              openTop,
              kerf,
              fitAllowance,
            });
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
