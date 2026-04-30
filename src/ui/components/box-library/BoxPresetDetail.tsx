import React from 'react';
import type { BoxLibraryPreset } from '../../../core/box/boxLibraryTypes';
import { BoxFeatureChips } from './BoxFeatureChips';
import { BoxPresetPreview } from './BoxPresetPreview';

interface BoxPresetDetailProps {
  preset: BoxLibraryPreset | null;
  onApplyPreset: (preset: BoxLibraryPreset) => void;
}

function row(label: string, value: string): React.ReactNode {
  return React.createElement('div', {
    key: label,
    style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9a9ab5' },
  },
    React.createElement('span', null, label),
    React.createElement('span', { style: { color: '#e0e0ec', fontFamily: "'JetBrains Mono', monospace" } }, value),
  );
}

export function BoxPresetDetail({ preset, onApplyPreset }: BoxPresetDetailProps) {
  if (!preset) {
    return React.createElement('div', {
      style: {
        padding: 18, color: '#9a9ab5', fontSize: 12, lineHeight: 1.5,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      },
    }, 'Select a box preset to preview its design and load its settings.');
  }

  return React.createElement('div', {
    style: { padding: 16, overflowY: 'auto' as const, minHeight: 0 },
    'data-testid': 'box-preset-detail',
  },
    React.createElement(BoxPresetPreview, { preset, mode: 'hero' }),
    React.createElement('h3', { style: { margin: '14px 0 6px', color: '#e0e0ec', fontSize: 18 } }, preset.name),
    React.createElement('p', { style: { margin: 0, color: '#9a9ab5', fontSize: 12, lineHeight: 1.5 } }, preset.description),
    React.createElement('div', { style: { marginTop: 12 } },
      React.createElement(BoxFeatureChips, { items: preset.featureBadges, accentColor: preset.accentColor }),
    ),
    React.createElement('div', {
      style: {
        display: 'grid', gap: 7, marginTop: 14,
        padding: 12, background: '#10131c', border: '1px solid #252540', borderRadius: 10,
      },
    },
      row('Width', `${preset.width} mm`),
      row('Height', `${preset.height} mm`),
      row('Depth', `${preset.depth} mm`),
      row('Material', `${preset.thickness} mm`),
      row('Kerf', `${preset.kerf} mm`),
      row('Fit', `${preset.fitAllowance} mm`),
    ),
    preset.recommendedUse
      ? React.createElement('div', {
          style: {
            marginTop: 12, padding: 11, borderRadius: 10,
            background: `${preset.accentColor}14`, border: `1px solid ${preset.accentColor}44`,
            color: '#cfd0e8', fontSize: 11, lineHeight: 1.45,
          },
        }, preset.recommendedUse)
      : null,
    React.createElement('button', {
      type: 'button',
      onClick: () => onApplyPreset(preset),
      'data-testid': 'box-use-preset',
      style: {
        width: '100%', marginTop: 14, padding: '10px 12px',
        background: `${preset.accentColor}22`, border: `1px solid ${preset.accentColor}`,
        color: '#e0f7ff', borderRadius: 9, fontSize: 12, fontWeight: 700,
        cursor: 'pointer',
      },
    }, 'Use this preset'),
    React.createElement('div', { style: { marginTop: 8, color: '#6f6f89', fontSize: 10, lineHeight: 1.4 } },
      preset.category === 'calibration'
        ? 'This is already a calibration-first preset.'
        : 'For a new material, generate the Fit-test Mini Box before scaling up.',
    ),
  );
}
