import React from 'react';
import { formatBoxLibraryCategory } from '../../../core/box/boxLibrary';
import type { BoxLibraryPreset } from '../../../core/box/boxLibraryTypes';
import { BoxFeatureChips } from './BoxFeatureChips';
import { BoxPresetPreview } from './BoxPresetPreview';

interface BoxPresetCardProps {
  preset: BoxLibraryPreset;
  selected: boolean;
  onClick: () => void;
}

export function BoxPresetCard({ preset, selected, onClick }: BoxPresetCardProps) {
  return React.createElement('button', {
    type: 'button',
    onClick,
    'data-testid': `box-preset-card-${preset.id}`,
    style: {
      width: '100%',
      textAlign: 'left' as const,
      background: selected ? 'rgba(0,212,255,0.08)' : '#10131c',
      border: selected ? `1px solid ${preset.accentColor}` : '1px solid #252540',
      borderRadius: 16,
      padding: 14,
      color: '#e0e0ec',
      cursor: 'pointer',
      boxShadow: selected ? `0 0 0 1px ${preset.accentColor}33` : 'none',
    },
  },
    React.createElement('div', {
      style: {
        width: '100%',
        aspectRatio: '16 / 10',
        overflow: 'hidden',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.05)',
        background: '#08080f',
      },
    },
      React.createElement(BoxPresetPreview, { preset, mode: 'card' }),
    ),
    React.createElement('div', { style: { fontSize: 14, fontWeight: 850, marginTop: 12 } }, preset.name),
    React.createElement('div', {
      style: {
        fontSize: 10.5, color: '#a5a5bd', lineHeight: 1.45,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical' as const,
        overflow: 'hidden',
      },
    }, preset.description),
    React.createElement('div', { style: { fontSize: 10, color: '#7b7b96', margin: '10px 0' } },
      `${preset.width} × ${preset.height} × ${preset.depth} mm · ${formatBoxLibraryCategory(preset.category)}`,
    ),
    React.createElement(BoxFeatureChips, {
      items: preset.featureBadges.slice(0, 2),
      accentColor: preset.accentColor,
    }),
  );
}
