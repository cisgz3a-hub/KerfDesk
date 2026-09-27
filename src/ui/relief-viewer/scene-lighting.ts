// applySceneLighting — how the ADR-102 3D scene is lit.
//
// The pre-IBL rig (one flat ambient + one directional) rendered a carve as
// featureless plastic: with no environment term, a machined surface has
// nothing to reflect, so curvature reads only through the single key light's
// N·L falloff. Image-based lighting from three's RoomEnvironment, prefiltered
// through PMREMGenerator, gives every facet a plausible surround to reflect,
// which is what makes tool marks and pocket walls legible.
//
// Tone mapping is Neutral rather than ACES on purpose: ACES shifts hue as it
// rolls off, which would drift the wood tone and (once toolpaths land) the
// move-kind color codes away from the swatches they are supposed to match.

import type * as ThreeNamespace from 'three';
import type { Scene, WebGLRenderer } from 'three';
import { viewer3dTheme } from '../theme/viewer3d-theme';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { prefilteredRoomEnvironment } from '../viewer3d/viewer3d-environment';

// The dynamically-imported three module, passed in rather than imported here
// so this module stays inside the ADR-102 §3 lazy-load boundary.
type ThreeModule = typeof ThreeNamespace;

const KEY_LIGHT_COLOR = 0xffffff;

export type SceneLightingHandle = {
  // Frees the prefiltered environment texture. The lights themselves are
  // owned by the scene graph and need no disposal.
  readonly dispose: () => void;
};

/**
 * Configures the renderer's output pipeline and installs the scene's light
 * rig, sized to the work envelope so the key light rakes across the carve
 * instead of staring straight down it.
 *
 * @param three The dynamically-imported three module (ADR-102 §3 lazy load).
 * @param renderer The scene's renderer; its tone mapping and pixel ratio are set here.
 * @param scene Receives `environment` plus the ambient/key/fill lights.
 * @param envelopeMm Work-envelope extents used to place the directional lights.
 */
export function applySceneLighting(
  three: ThreeModule,
  renderer: WebGLRenderer,
  scene: Scene,
  envelopeMm: { readonly widthMm: number; readonly heightMm: number },
  pixelRatio: number,
): SceneLightingHandle {
  const { lighting } = viewer3dTheme;
  renderer.setPixelRatio(Math.min(pixelRatio, viewer3dTheme.maxPixelRatio));
  renderer.toneMapping = three.NeutralToneMapping;
  renderer.toneMappingExposure = lighting.toneMappingExposure;

  const environment = prefilteredRoomEnvironment(three, renderer, lighting.environmentBlurSigma);
  scene.environment = environment;
  scene.environmentIntensity = lighting.environmentIntensity;

  scene.add(new three.AmbientLight(KEY_LIGHT_COLOR, lighting.ambientIntensity));
  const span = Math.max(envelopeMm.widthMm, envelopeMm.heightMm);
  const key = new three.DirectionalLight(KEY_LIGHT_COLOR, lighting.keyIntensity);
  key.position.set(envelopeMm.widthMm, -envelopeMm.heightMm, span);
  scene.add(key);
  // Opposing fill at a shallower angle so walls facing away from the key
  // light keep their shape instead of crushing to black.
  const fill = new three.DirectionalLight(KEY_LIGHT_COLOR, lighting.fillIntensity);
  fill.position.set(-envelopeMm.widthMm, envelopeMm.heightMm, span * 0.5);
  scene.add(fill);

  return {
    dispose: () => {
      scene.environment = null;
      environment.dispose();
    },
  };
}
