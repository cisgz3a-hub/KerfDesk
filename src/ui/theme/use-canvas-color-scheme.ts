import { useSyncExternalStore } from 'react';
import {
  getCanvasColorScheme,
  subscribeCanvasColorScheme,
  type CanvasColorScheme,
} from './canvas-color-scheme';

export function useCanvasColorScheme(): CanvasColorScheme {
  return useSyncExternalStore(subscribeCanvasColorScheme, getCanvasColorScheme, () => 'light');
}
