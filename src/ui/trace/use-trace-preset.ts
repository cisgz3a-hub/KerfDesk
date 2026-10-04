import { useState } from 'react';
import { useEdition } from '../licensing/edition';
import {
  ADVANCED_TRACE_PRESET_NAMES,
  CNC_TRACE_PRESET_NAME,
  DEFAULT_TRACE_PRESET_NAME,
} from './dialog-parts';

export function useTracePreset(
  machineKind: 'laser' | 'cnc',
  initialPreset?: string,
): { readonly preset: string; readonly selectPreset: (next: string) => void } {
  // A Re-trace opens on the preset recorded with the trace (ADR-408). Otherwise
  // Pro CNC opens on Smooth. Line Art is the only Free tracer, so a new
  // Free trace or a recorded Pro preset opens on Line Art on either machine.
  const { pro } = useEdition();
  const [preset, setPreset] = useState<string>(() =>
    initialPreset !== undefined && (pro || !ADVANCED_TRACE_PRESET_NAMES.has(initialPreset))
      ? initialPreset
      : pro && machineKind === 'cnc'
        ? CNC_TRACE_PRESET_NAME
        : DEFAULT_TRACE_PRESET_NAME,
  );
  return { preset, selectPreset: setPreset };
}
