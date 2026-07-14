export const CANVAS_START_MARKERS_KEY = 'laserforge.canvas-start-markers.v1';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readCanvasStartMarkersVisible(
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  try {
    return storage?.getItem(CANVAS_START_MARKERS_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeCanvasStartMarkersVisible(
  visible: boolean,
  storage: PreferenceStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(CANVAS_START_MARKERS_KEY, visible ? '1' : '0');
  } catch {
    // Storage is optional; the in-memory preference still applies this session.
  }
}

function browserStorage(): PreferenceStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}
