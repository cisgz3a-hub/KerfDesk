import React, { useMemo } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { computeObjectBounds } from '../../geometry/bounds';

export type StartMode = 'absolute' | 'current' | 'savedOrigin';

interface StartPositionWizardProps {
  scene: Scene;
  currentMode: StartMode;
  onSelectMode: (mode: StartMode, origin: { x: number; y: number }) => void;
  onClose: () => void;
  onSaveOrigin?: () => void;
  machinePosition?: { x: number; y: number } | null;
  savedOrigin?: { x: number; y: number } | null;
}

function previewCoords(
  mode: StartMode,
  designBounds: { minX: number; minY: number; maxX: number; maxY: number },
  machinePosition: { x: number; y: number } | null | undefined,
  savedOrigin: { x: number; y: number } | null | undefined,
): { designX: number; designY: number } {
  let designX = designBounds.minX;
  let designY = designBounds.minY;
  if (mode === 'current' && machinePosition) {
    designX = machinePosition.x;
    designY = machinePosition.y;
  } else if (mode === 'savedOrigin' && savedOrigin) {
    designX = savedOrigin.x;
    designY = savedOrigin.y;
  }
  return { designX, designY };
}

function previewForMode(
  mode: StartMode,
  designBounds: { minX: number; minY: number; maxX: number; maxY: number },
  machinePosition: { x: number; y: number } | null | undefined,
  savedOrigin: { x: number; y: number } | null | undefined,
): { designX: number; designY: number; label: string } | null {
  if (mode === 'current' && !machinePosition) return null;
  const { designX, designY } = previewCoords(mode, designBounds, machinePosition, savedOrigin);
  if (mode === 'absolute') {
    return {
      designX,
      designY,
      label: `Design corner: X${designX.toFixed(1)} Y${designY.toFixed(1)} mm (bed ${designBounds.minX.toFixed(0)}–${designBounds.maxX.toFixed(0)} × ${designBounds.minY.toFixed(0)}–${designBounds.maxY.toFixed(0)})`,
    };
  }
  if (mode === 'current' && machinePosition) {
    return {
      designX,
      designY,
      label: `Start from head: X${designX.toFixed(1)} Y${designY.toFixed(1)} mm`,
    };
  }
  return {
    designX,
    designY,
    label: savedOrigin
      ? `Saved origin: X${designX.toFixed(1)} Y${designY.toFixed(1)} mm`
      : `Fallback corner: X${designX.toFixed(1)} Y${designY.toFixed(1)} mm (no saved origin — uses design min)`,
  };
}

export function StartPositionWizard({
  scene, currentMode, onSelectMode, onClose, machinePosition, savedOrigin,
}: StartPositionWizardProps) {
  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', ui-monospace, monospace";

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

  const modeRows = useMemo(() => [
    {
      mode: 'absolute' as const,
      icon: '📍',
      title: 'Place on Bed',
      description:
        `Design stays exactly where you placed it on the canvas. Cuts at X${designBounds.minX.toFixed(0)}–${designBounds.maxX.toFixed(0)}, Y${designBounds.minY.toFixed(0)}–${designBounds.maxY.toFixed(0)} mm from machine home.`,
      disabled: false as const,
      disabledReason: '',
    },
    {
      mode: 'current' as const,
      icon: '🎯',
      title: 'Start Where Head Is Now',
      description: 'Design starts at the current laser position. Move the head first, then start.',
      disabled: !machinePosition,
      disabledReason: 'Connect to your laser first to use this mode.',
    },
    {
      mode: 'savedOrigin' as const,
      icon: '⚑',
      title: 'Use Saved Origin',
      description: savedOrigin
        ? `Design aligns to your saved reference (X${savedOrigin.x.toFixed(1)}, Y${savedOrigin.y.toFixed(1)}). Great for repeat jobs.`
        : 'Design aligns to a saved reference point. Zero your machine, then save origin below. Until then, uses design corner like Place on Bed.',
      disabled: false as const,
      disabledReason: '',
    },
  ], [designBounds, machinePosition, savedOrigin]);

  const renderPreview = (mode: StartMode) => {
    const bedW = scene.canvas.width;
    const bedH = scene.canvas.height;
    const svgW = 200;
    const svgH = 88;
    const pad = 10;
    const scale = Math.min((svgW - pad * 2) / bedW, (svgH - pad * 2) / bedH);
    const offsetX = (svgW - bedW * scale) / 2;
    const offsetY = (svgH - bedH * scale) / 2;

    const { designX, designY } = previewCoords(mode, designBounds, machinePosition, savedOrigin);
    const dw = designBounds.maxX - designBounds.minX;
    const dh = designBounds.maxY - designBounds.minY;

    return React.createElement('svg', {
      width: '100%',
      height: svgH,
      viewBox: `0 0 ${svgW} ${svgH}`,
      style: { display: 'block', maxWidth: '100%' },
    },
      React.createElement('rect', {
        x: offsetX, y: offsetY,
        width: bedW * scale, height: bedH * scale,
        fill: 'none', stroke: '#252540', strokeWidth: 1, strokeDasharray: '4,2',
      }),
      React.createElement('text', {
        x: offsetX + 3, y: offsetY + 9,
        fill: '#333355', fontSize: 7, fontFamily: font,
      }, `${bedW}×${bedH}`),
      React.createElement('rect', {
        x: offsetX + designX * scale,
        y: offsetY + designY * scale,
        width: Math.max(dw * scale, 6),
        height: Math.max(dh * scale, 6),
        fill: mode === currentMode ? 'rgba(0,212,255,0.2)' : 'rgba(255,212,68,0.2)',
        stroke: mode === currentMode ? '#00d4ff' : '#ffd444',
        strokeWidth: 1, rx: 2,
      }),
      mode !== 'absolute' && React.createElement('circle', {
        cx: offsetX + designX * scale,
        cy: offsetY + designY * scale,
        r: 3, fill: '#ff4466', stroke: '#ff4466', strokeWidth: 1,
      }),
      React.createElement('circle', {
        cx: offsetX, cy: offsetY,
        r: 2, fill: 'none', stroke: '#555570', strokeWidth: 1,
      }),
      React.createElement('text', {
        x: offsetX + 4, y: offsetY + bedH * scale - 2,
        fill: '#333355', fontSize: 6, fontFamily: font,
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
        style: { padding: '8px 12px', display: 'flex', flexDirection: 'column' as const, gap: 8 },
      },
        ...modeRows.map(({ mode, icon, title, description, disabled, disabledReason }) => {
          const preview = previewForMode(mode, designBounds, machinePosition, savedOrigin);

          return React.createElement('div', {
            key: mode,
            style: {
              padding: '12px 14px',
              background: '#0a0a14',
              border: '1px solid #1a1a2e',
              borderRadius: 10,
              opacity: disabled ? 0.4 : 1,
            },
          },
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
            },
              React.createElement('span', { style: { fontSize: 22 } }, icon),
              React.createElement('span', { style: { flex: 1, color: '#e0e0ec', fontSize: 13, fontWeight: 600 } }, title),
              React.createElement('button', {
                onClick: () => {
                  if (disabled) return;
                  if (preview) {
                    onSelectMode(mode, { x: preview.designX, y: preview.designY });
                  }
                  onClose();
                },
                disabled,
                style: {
                  padding: '5px 16px',
                  background: disabled ? '#1a1a2e' : 'rgba(0,212,255,0.1)',
                  border: disabled ? '1px solid #252540' : '1px solid #00d4ff',
                  borderRadius: 6,
                  color: disabled ? '#333355' : '#00d4ff',
                  fontSize: 11, fontWeight: 600,
                  cursor: disabled ? 'default' : 'pointer',
                  fontFamily: font,
                  flexShrink: 0,
                },
              }, 'Use'),
            ),

            React.createElement('div', {
              style: { color: disabled ? '#333355' : '#8888aa', fontSize: 11, lineHeight: 1.5, marginBottom: 8, paddingLeft: 32 },
            }, disabled ? disabledReason : description),

            !disabled && preview && renderPreview(mode),

            !disabled && preview && React.createElement('div', {
              style: { color: '#555570', fontSize: 9, marginTop: 4, paddingLeft: 32, fontFamily: mono },
            }, preview.label),
          );
        }),
      ),

      React.createElement('div', {
        style: { padding: '12px 20px', borderTop: '1px solid #1a1a2e', display: 'flex', gap: 8, flexShrink: 0 },
      },
        machinePosition && React.createElement('button', {
          onClick: () => {
            localStorage.setItem('laserforge_saved_origin', JSON.stringify(machinePosition));
          },
          style: {
            padding: '6px 14px', background: 'rgba(45,212,160,0.08)',
            border: '1px solid rgba(45,212,160,0.2)', borderRadius: 6,
            color: '#2dd4a0', fontSize: 11, cursor: 'pointer', fontFamily: font,
          },
        }, '📌 Save current position as origin'),

        React.createElement('div', { style: { flex: 1 } }),

        React.createElement('button', {
          onClick: onClose,
          style: {
            padding: '8px 18px', background: '#0a0a14',
            border: '1px solid #252540', borderRadius: 6,
            color: '#8888aa', fontSize: 12, cursor: 'pointer', fontFamily: font,
          },
        }, 'Cancel'),
      ),
    ),
  );
}
