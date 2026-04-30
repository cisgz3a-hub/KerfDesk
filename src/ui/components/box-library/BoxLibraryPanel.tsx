import React from 'react';
import { filterBoxPresets } from '../../../core/box/boxLibrary';
import type { BoxLibraryPreset, BoxPresetCategory } from '../../../core/box/boxLibraryTypes';
import { BoxCategoryTabs } from './BoxCategoryTabs';
import { BoxLibrarySearch } from './BoxLibrarySearch';
import { BoxPresetCard } from './BoxPresetCard';

interface BoxLibraryPanelProps {
  presets: BoxLibraryPreset[];
  selectedPresetId: string | null;
  selectedCategory: BoxPresetCategory | 'all';
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (category: BoxPresetCategory | 'all') => void;
  onSelectPreset: (presetId: string) => void;
}

export function BoxLibraryPanel({
  presets,
  selectedPresetId,
  selectedCategory,
  searchQuery,
  onSearchChange,
  onCategoryChange,
  onSelectPreset,
}: BoxLibraryPanelProps) {
  const filtered = filterBoxPresets(presets, searchQuery, selectedCategory);

  return React.createElement('div', {
    style: {
      width: '100%',
      height: '100%',
      borderRight: '1px solid #1a1a2e',
      display: 'flex',
      flexDirection: 'column' as const,
      minHeight: 0,
      background: '#12121e',
    },
  },
    React.createElement('div', { style: { padding: 16, borderBottom: '1px solid #1a1a2e' } },
      React.createElement(BoxLibrarySearch, { value: searchQuery, onChange: onSearchChange }),
      React.createElement(BoxCategoryTabs, { value: selectedCategory, onChange: onCategoryChange }),
      React.createElement('div', { style: { fontSize: 10, color: '#6f6f89' } }, `${filtered.length} presets`),
    ),
    React.createElement('div', {
      style: {
        padding: '16px 18px 18px 16px',
        display: 'grid',
        gap: 14,
        overflowY: 'auto' as const,
        minHeight: 0,
        alignContent: 'start',
        scrollbarGutter: 'stable',
      },
      'data-testid': 'box-preset-list',
    },
      filtered.length === 0
        ? React.createElement('div', {
            style: { color: '#9a9ab5', fontSize: 12, lineHeight: 1.5, padding: 12 },
          }, 'No presets found. Try a different keyword or switch categories.')
        : filtered.map(preset => React.createElement(BoxPresetCard, {
            key: preset.id,
            preset,
            selected: preset.id === selectedPresetId,
            onClick: () => onSelectPreset(preset.id),
          })),
    ),
  );
}
