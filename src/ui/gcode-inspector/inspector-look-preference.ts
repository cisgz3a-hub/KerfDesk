// The G-code 3D view's look, remembered per browser (ADR-426). Classic is
// the default; an operator who picks Studio keeps it across sessions.

import { useCallback, useState } from 'react';
import { browserLocalStorage } from '../state/browser-local-storage';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { VIEWER3D_LOOKS, type Viewer3dLook } from '../viewer3d/viewer3d-look';

export const INSPECTOR_LOOK_KEY = 'laserforge.inspector-3d-look.v1';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readInspectorLook(
  storage: PreferenceStorage | null = browserLocalStorage(),
): Viewer3dLook {
  try {
    const stored = storage?.getItem(INSPECTOR_LOOK_KEY);
    return VIEWER3D_LOOKS.find((look) => look === stored) ?? 'classic';
  } catch {
    return 'classic';
  }
}

export function writeInspectorLook(
  look: Viewer3dLook,
  storage: PreferenceStorage | null = browserLocalStorage(),
): void {
  try {
    storage?.setItem(INSPECTOR_LOOK_KEY, look);
  } catch {
    // Storage is optional; the in-memory choice still applies this session.
  }
}

export function useInspectorLook(): readonly [Viewer3dLook, (look: Viewer3dLook) => void] {
  const [look, setLook] = useState<Viewer3dLook>(() => readInspectorLook());
  const choose = useCallback((next: Viewer3dLook) => {
    setLook(next);
    writeInspectorLook(next);
  }, []);
  return [look, choose] as const;
}
