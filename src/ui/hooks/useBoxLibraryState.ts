import { useState } from 'react';
import type { BoxPresetCategory } from '../../core/box/boxLibraryTypes';

export interface BoxLibraryState {
  selectedPresetId: string | null;
  selectedCategory: BoxPresetCategory | 'all';
  searchQuery: string;
}

export interface UseBoxLibraryStateResult extends BoxLibraryState {
  setSelectedPresetId: (id: string | null) => void;
  setSelectedCategory: (category: BoxPresetCategory | 'all') => void;
  setSearchQuery: (query: string) => void;
}

export function useBoxLibraryState(initialPresetId?: string): UseBoxLibraryStateResult {
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(initialPresetId ?? null);
  const [selectedCategory, setSelectedCategory] = useState<BoxPresetCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  return {
    selectedPresetId,
    selectedCategory,
    searchQuery,
    setSelectedPresetId,
    setSelectedCategory,
    setSearchQuery,
  };
}
