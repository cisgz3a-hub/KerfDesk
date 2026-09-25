import { useState } from 'react';
import { TRACE_PRESETS } from '../../core/trace';
import { CNC_TRACE_PRESET_NAME, DEFAULT_TRACE_PRESET_NAME } from './dialog-parts';
import type { BoundaryMode } from './region-enhance-trace';

export function useTracePreset(
  machineKind: 'laser' | 'cnc',
  setBoundaryMode: (mode: BoundaryMode) => void,
  initialPreset?: string,
): { readonly preset: string; readonly selectPreset: (next: string) => void } {
  // A Re-trace opens on the preset recorded with the trace (ADR-400).
  const [preset, setPreset] = useState<string>(
    () =>
      initialPreset ?? (machineKind === 'cnc' ? CNC_TRACE_PRESET_NAME : DEFAULT_TRACE_PRESET_NAME),
  );
  return {
    preset,
    selectPreset: (next) => {
      setPreset(next);
      // Enhance replaces whole contours; ribbons spanning a photo need Crop.
      if (TRACE_PRESETS[next]?.photoDetail !== undefined) setBoundaryMode('crop');
    },
  };
}
