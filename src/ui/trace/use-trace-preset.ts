import { useState } from 'react';
import { TRACE_PRESETS } from '../../core/trace';
import { useEdition } from '../licensing/edition';
import {
  ADVANCED_TRACE_PRESET_NAMES,
  CNC_TRACE_PRESET_NAME,
  DEFAULT_TRACE_PRESET_NAME,
} from './dialog-parts';
import type { BoundaryMode } from './region-enhance-trace';

export function useTracePreset(
  machineKind: 'laser' | 'cnc',
  setBoundaryMode: (mode: BoundaryMode) => void,
  initialPreset?: string,
): { readonly preset: string; readonly selectPreset: (next: string) => void } {
  // A Re-trace opens on the preset recorded with the trace (ADR-408). Otherwise
  // CNC opens on Smooth, the preset that traces cleanly on a router. It is a
  // starting selection, not a restriction — every preset stays selectable. An
  // advanced preset needs Pro (ADR-540), so KerfDesk Free starts on the default.
  const { pro } = useEdition();
  const [preset, setPreset] = useState<string>(() =>
    initialPreset !== undefined && (pro || !ADVANCED_TRACE_PRESET_NAMES.has(initialPreset))
      ? initialPreset
      : machineKind === 'cnc'
        ? CNC_TRACE_PRESET_NAME
        : DEFAULT_TRACE_PRESET_NAME,
  );
  return {
    preset,
    selectPreset: (next) => {
      setPreset(next);
      // Enhance replaces whole contours; ribbons spanning a photo and colour
      // regions sharing boundaries need Crop.
      const options = TRACE_PRESETS[next];
      if (options?.photoDetail !== undefined || options?.colourLayers !== undefined) {
        setBoundaryMode('crop');
      }
    },
  };
}
