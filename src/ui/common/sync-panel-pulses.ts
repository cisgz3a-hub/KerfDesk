// Collapsed-panel hints beat in step. A CSS animation starts when its element
// gets the class, so a rail collapsed a second after another would pulse a
// second behind it forever. Pinning each hint animation's start to the
// document timeline's origin gives every hint the same phase, whenever it
// started, and again after hover or focus pauses and restarts it.

import { useEffect } from 'react';

export const PANEL_PULSE_ANIMATION = 'lf-panel-expand-pulse';

export function syncPanelPulse(event: AnimationEvent): void {
  if (event.animationName !== PANEL_PULSE_ANIMATION) return;
  const target = event.target;
  if (!(target instanceof Element) || typeof target.getAnimations !== 'function') return;
  for (const animation of target.getAnimations()) {
    if ('animationName' in animation && animation.animationName === PANEL_PULSE_ANIMATION) {
      animation.startTime = 0;
    }
  }
}

// Each control that can carry the hint calls this; one document listener is
// shared and removed when the last of them unmounts.
let listeningControls = 0;

export function useSyncedPanelPulses(): void {
  useEffect(() => {
    if (listeningControls === 0) document.addEventListener('animationstart', syncPanelPulse);
    listeningControls += 1;
    return () => {
      listeningControls -= 1;
      if (listeningControls === 0) document.removeEventListener('animationstart', syncPanelPulse);
    };
  }, []);
}
