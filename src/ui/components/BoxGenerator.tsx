import React from 'react';
import { BOX_LIBRARY_PRESETS } from '../../core/box/boxLibrary';
import type { Scene } from '../../core/scene/Scene';
import type { SceneObject } from '../../core/scene/SceneObject';
import { BoxPresetPreview } from './box-library/BoxPresetPreview';

interface BoxGeneratorProps {
  scene: Scene;
  onGenerate: (objects: SceneObject[]) => void;
  onClose: () => void;
  onOpenStudio?: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";

export function BoxGenerator({ onClose, onOpenStudio }: BoxGeneratorProps) {
  const heroPreset = BOX_LIBRARY_PRESETS[0]!;

  return React.createElement('div', {
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        width: 520,
        maxWidth: '92vw',
        background: '#12121e',
        border: '1px solid #252540',
        borderRadius: 18,
        boxShadow: '0 24px 70px rgba(0,0,0,0.65)',
        overflow: 'hidden',
      },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); },
    },
      React.createElement('div', { style: { padding: 20, borderBottom: '1px solid #1a1a2e' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' } },
          React.createElement('div', null,
            React.createElement('div', { style: { color: '#e0e0ec', fontSize: 20, fontWeight: 900 } }, 'Box Studio'),
            React.createElement('div', { style: { color: '#8f8faa', fontSize: 12, lineHeight: 1.5, marginTop: 5 } },
              'A full-page workspace for professional presets, visual previews, and fit-aware box generation.',
            ),
          ),
          React.createElement('button', {
            type: 'button',
            onClick: onClose,
            style: { background: 'none', border: 0, color: '#666680', fontSize: 20, cursor: 'pointer' },
          }, 'x'),
        ),
      ),
      React.createElement('div', { style: { padding: 20 } },
        React.createElement('div', {
          style: {
            background: '#0a0a14',
            border: '1px solid #252540',
            borderRadius: 14,
            overflow: 'hidden',
            marginBottom: 16,
          },
        },
          React.createElement(BoxPresetPreview, { preset: heroPreset, mode: 'hero' }),
        ),
        React.createElement('div', {
          style: { color: '#c8c8dc', fontSize: 13, lineHeight: 1.6, marginBottom: 18 },
        },
          'The box library has outgrown a compact modal. Open the full studio for a wider preset browser, larger hero preview, stat cards, and a bigger generated layout view.',
        ),
        React.createElement('div', { style: { display: 'flex', gap: 10 } },
          React.createElement('button', {
            type: 'button',
            onClick: () => {
              onClose();
              onOpenStudio?.();
            },
            style: {
              flex: 1,
              padding: '12px 14px',
              background: 'rgba(45,212,160,0.14)',
              border: '1px solid #2dd4a0',
              borderRadius: 10,
              color: '#2dd4a0',
              fontSize: 13,
              fontWeight: 800,
              cursor: 'pointer',
              fontFamily: font,
            },
          }, 'Open Full Box Studio'),
          React.createElement('button', {
            type: 'button',
            onClick: onClose,
            style: {
              padding: '12px 14px',
              background: '#0a0a14',
              border: '1px solid #252540',
              borderRadius: 10,
              color: '#9a9ab5',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: font,
            },
          }, 'Close'),
        ),
      ),
    ),
  );
}
