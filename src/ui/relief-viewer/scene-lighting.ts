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
): SceneLightingHandle {
  const { lighting } = viewer3dTheme;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, viewer3dTheme.maxPixelRatio));
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
      environment?.dispose();
    },
  };
}

// PMREMGenerator is disposed immediately: it holds render targets and shader
// materials that are only needed while prefiltering, not afterwards. The
// RoomEnvironment source scene is likewise transient.
function prefilteredRoomEnvironment(
  three: ThreeModule,
  renderer: WebGLRenderer,
  blurSigma: number,
): Scene['environment'] {
  const generator = new three.PMREMGenerator(renderer);
  const room = new three.Scene();
  buildRoom(three, room);
  const target = generator.fromScene(room, blurSigma);
  generator.dispose();
  return target.texture;
}

// A minimal three-sided light box, standing in for the RoomEnvironment addon.
// Inlining it keeps the lazily-loaded 3D chunk from pulling in a second addon
// module for what amounts to five emissive boxes.
function buildRoom(three: ThreeModule, room: Scene): void {
  const geometry = new three.BoxGeometry();
  const add = (
    intensity: number,
    scale: readonly [number, number, number],
    position: readonly [number, number, number],
  ): void => {
    const mesh = new three.Mesh(
      geometry,
      new three.MeshBasicMaterial({ color: KEY_LIGHT_COLOR, side: three.BackSide }),
    );
    mesh.material.color.multiplyScalar(intensity);
    mesh.scale.set(...scale);
    mesh.position.set(...position);
    room.add(mesh);
  };
  add(1, [20, 20, 20], [0, 0, 0]); // enclosing shell
  add(3.2, [8, 0.5, 8], [0, 0, 9]); // overhead softbox
  add(1.4, [0.5, 8, 8], [-9, 0, 2]); // side bounce
  add(0.8, [0.5, 8, 8], [9, 0, 2]); // opposing bounce
}
