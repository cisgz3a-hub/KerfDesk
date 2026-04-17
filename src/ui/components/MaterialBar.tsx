import React, { forwardRef, useImperativeHandle, useState } from 'react';
import type { Scene } from '../../core/scene/Scene';
import {
  MATERIAL_CATEGORIES,
  MATERIAL_PRESETS,
  getUserMaterials,
} from '../../core/materials/MaterialPresets';
import { theme } from '../styles/theme';

export interface MaterialBarHandle {
  closeDropdown: () => void;
}

export interface MaterialBarProps {
  scene: Scene;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToBed: () => void;
  onClearMaterial: () => void;
  /** Returns true if the preset was applied (closes dropdown). False keeps menu open. */
  onApplyPreset: (presetName: string) => boolean;
  onOpenMaterialLibrary: () => void;
}

function materialChipStyle(type?: string) {
  const styles: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    wood:    { bg: 'rgba(139,90,43,0.10)', border: 'rgba(139,90,43,0.30)', text: '#C4956A', icon: '🪵' },
    acrylic: { bg: 'rgba(100,180,255,0.08)', border: 'rgba(100,180,255,0.25)', text: '#80C8FF', icon: '💎' },
    leather: { bg: 'rgba(160,82,45,0.10)', border: 'rgba(160,82,45,0.30)', text: '#C08060', icon: '🟤' },
    paper:   { bg: 'rgba(240,230,210,0.08)', border: 'rgba(200,190,170,0.25)', text: '#D4C8B0', icon: '📄' },
    fabric:  { bg: 'rgba(180,130,180,0.08)', border: 'rgba(180,130,180,0.25)', text: '#B882B8', icon: '🧵' },
    metal:   { bg: 'rgba(180,190,200,0.08)', border: 'rgba(180,190,200,0.25)', text: '#B4BEC8', icon: '⚙' },
    cardboard: { bg: 'rgba(170,130,80,0.08)', border: 'rgba(170,130,80,0.25)', text: '#C0A060', icon: '📦' },
  };
  return styles[type || ''] || { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)', text: '#8888a8', icon: '◻' };
}

const matToolbarBtn: React.CSSProperties = {
  width: 22, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: `1px solid ${theme.border.subtle}`, borderRadius: 4,
  background: '#12121f', color: theme.text.secondary, cursor: 'pointer',
  fontSize: 12, fontFamily: theme.font.ui, padding: 0,
};

const matDropdownItem: React.CSSProperties = {
  display: 'block', width: '100%', padding: '5px 12px', border: 'none',
  background: 'transparent', color: theme.text.secondary, fontSize: 11,
  textAlign: 'left' as const, cursor: 'pointer', fontFamily: theme.font.ui,
};

export const MaterialBar = forwardRef<MaterialBarHandle, MaterialBarProps>(function MaterialBar({
  scene,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onFitToBed,
  onClearMaterial,
  onApplyPreset,
  onOpenMaterialLibrary,
}, ref) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    closeDropdown: () => setDropdownOpen(false),
  }), []);

  return React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px',
      background: '#0e0e1a',
      borderBottom: `1px solid ${theme.border.subtle}`,
      flexShrink: 0,
      position: 'relative' as const,
      zIndex: 20,
    },
  },
    // Zoom controls
    React.createElement('button', {
      onClick: onZoomOut,
      style: { ...matToolbarBtn },
    }, '−'),
    React.createElement('span', {
      style: { color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, minWidth: 32, textAlign: 'center' as const },
    }, `${zoomLevel}%`),
    React.createElement('button', {
      onClick: onZoomIn,
      style: { ...matToolbarBtn },
    }, '+'),
    React.createElement('button', {
      onClick: onFitToBed,
      style: { ...matToolbarBtn, width: 'auto' as const, padding: '0 7px', fontSize: 9 },
    }, 'Fit'),
    // Divider
    React.createElement('div', { style: { width: 1, height: 16, background: theme.border.subtle } }),
    // Material chip
    React.createElement('div', { style: { position: 'relative' as const } },
      React.createElement('button', {
        onClick: () => setDropdownOpen(v => !v),
        style: {
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 10px 3px 7px',
          borderRadius: 16,
          border: `1px solid ${materialChipStyle(scene.material?.type).border}`,
          background: materialChipStyle(scene.material?.type).bg,
          color: materialChipStyle(scene.material?.type).text,
          cursor: 'pointer', fontSize: 11, fontWeight: 500,
          fontFamily: theme.font.ui,
        },
      },
        React.createElement('span', { style: { fontSize: 11 } }, materialChipStyle(scene.material?.type).icon),
        React.createElement('span', {}, scene.material?.name || 'No material'),
        React.createElement('span', { style: { fontSize: 7, marginLeft: 2, opacity: 0.5 } }, '▼'),
      ),
      // Dropdown
      dropdownOpen && React.createElement('div', {
        style: {
          position: 'absolute' as const, top: '100%', left: 0, marginTop: 4,
          width: 260, maxHeight: 340, overflowY: 'auto' as const,
          background: '#12121f', border: `1px solid ${theme.border.subtle}`,
          borderRadius: 8, padding: '4px 0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          zIndex: 100,
        },
      },
        // No material option
        React.createElement('button', {
          onClick: () => {
            onClearMaterial();
            setDropdownOpen(false);
          },
          style: { ...matDropdownItem, color: theme.text.secondary },
        }, '◻ No material'),
        // Categorised presets
        ...MATERIAL_CATEGORIES.map(cat => {
          const presets = MATERIAL_PRESETS.filter(p => p.category === cat);
          if (presets.length === 0) return null;
          return React.createElement(React.Fragment, { key: cat },
            React.createElement('div', {
              style: { padding: '7px 12px 2px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: theme.text.tertiary },
            }, cat),
            ...presets.map(p =>
              React.createElement('button', {
                key: p.name,
                onClick: () => {
                  if (onApplyPreset(p.name)) setDropdownOpen(false);
                },
                style: {
                  ...matDropdownItem,
                  fontWeight: scene.material?.name === p.name ? 600 : 400,
                  color: scene.material?.name === p.name ? theme.text.primary : theme.text.secondary,
                  background: scene.material?.name === p.name ? 'rgba(255,255,255,0.04)' : 'transparent',
                },
              }, p.name),
            ),
          );
        }).filter(Boolean),
        // User materials
        (() => {
          const userMats = getUserMaterials();
          if (userMats.length === 0) return null;
          return React.createElement(React.Fragment, { key: 'user-mats' },
            React.createElement('div', {
              style: { padding: '7px 12px 2px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: theme.text.tertiary },
            }, 'My Materials'),
            ...userMats.map(m =>
              React.createElement('button', {
                key: m.id,
                onClick: () => {
                  if (onApplyPreset(m.name)) setDropdownOpen(false);
                },
                style: { ...matDropdownItem },
              }, `★ ${m.name}`),
            ),
          );
        })(),
        // Manage library link
        React.createElement('div', { style: { height: 1, background: theme.border.subtle, margin: '4px 0' } }),
        React.createElement('button', {
          onClick: () => {
            onOpenMaterialLibrary();
            setDropdownOpen(false);
          },
          style: { ...matDropdownItem, color: theme.text.accent },
        }, '+ Manage material library…'),
      ),
    ),
  );
});
