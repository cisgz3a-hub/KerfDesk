// Registration layer — the reserved, color-keyed layer that holds the locked
// rectangle used as a physical placement jig (ADR-057). It is identified by a
// reserved id ('registration'), NOT by a color hex, mirroring the existing
// calibration-label layers (material-test-labels, scan-offset-calibration-labels).
// That keeps identification collision-free (a user can't hand-author a layer with
// this id) and lets the jig survive save/load and the two-run output toggle with
// no schema change. The object->layer join still happens by color (compile-job.ts),
// so the box object carries this layer's reserved color.

import { combinedBBox, type AABB } from './hit-test';
import { createLayer, type Layer } from './layer';
import { sceneObjectUsesOperation } from './operation-binding';
import type { Scene } from './scene';
import type { SceneObject, ShapeObject } from './scene-object';

// Reserved id — distinct from the color-hex ids normal layers use, so the jig is
// located by id without any color collision.
export const REGISTRATION_LAYER_ID = 'registration';

// Reserved color the box object binds to. Saturated + uncommon so a user's
// artwork is unlikely to land on this layer by accident. Identification keys on
// REGISTRATION_LAYER_ID above, not this value, so a color collision is cosmetic
// at worst. Lowercase 6-digit hex per the Layer.color contract.
export const REGISTRATION_LAYER_COLOR = '#ff00aa';

export function createRegistrationLayer(): Layer {
  // Line mode: the jig is a thin outline the operator burns once as a placement
  // reference, not a filled or raster engrave. Power/speed inherit the line
  // defaults; the operator tunes them for a light scribe on their material.
  return createLayer({
    id: REGISTRATION_LAYER_ID,
    name: 'Registration jig',
    color: REGISTRATION_LAYER_COLOR,
    mode: 'line',
  });
}

export function isRegistrationLayer(layer: Layer): boolean {
  return layer.id === REGISTRATION_LAYER_ID;
}

// Per-object test for the jig box, used by the canvas renderer to draw it
// distinctly. Keys on the reserved color (an object has no layer id); a color
// collision is cosmetic only. The box is movable/unlocked, so this does NOT key on
// the locked flag.
export function isRegistrationBox(object: SceneObject): boolean {
  return (
    object.kind === 'shape' &&
    (object.operationIds?.includes(REGISTRATION_LAYER_ID) === true ||
      (object.operationIds === undefined && object.color === REGISTRATION_LAYER_COLOR))
  );
}

export function findRegistrationLayer(scene: Scene): Layer | null {
  return scene.layers.find((layer) => layer.id === REGISTRATION_LAYER_ID) ?? null;
}

// The rectangle object(s) that make up the jig: shapes on the registration layer
// (matched by its color). Returns [] when no jig is present. The box is movable, so
// this is NOT gated on the locked flag — the reserved layer + color is the signal.
export function findRegistrationBoxes(scene: Scene): ReadonlyArray<ShapeObject> {
  const layer = findRegistrationLayer(scene);
  if (layer === null) return [];
  return scene.objects.filter(
    (object): object is ShapeObject =>
      object.kind === 'shape' && sceneObjectUsesOperation(object, layer),
  );
}

// Scene-space bounds of the registration box(es) — the anchor both burn runs
// share so the artwork lands inside the box, not at the bed corner (ADR-057).
// Null when no registration jig is present.
export function findRegistrationBoxBounds(scene: Scene): AABB | null {
  return combinedBBox(findRegistrationBoxes(scene));
}

export function hasRegistrationArtwork(scene: Scene): boolean {
  const operations = artworkOperations(scene, false);
  if (operations.length === 0) return false;
  return scene.objects.some(
    (object) =>
      !isRegistrationBox(object) &&
      operations.some((operation) => sceneObjectUsesOperation(object, operation)),
  );
}

function hasOutputRegistrationArtwork(scene: Scene): boolean {
  const operations = artworkOperations(scene, true);
  if (operations.length === 0) return false;
  return scene.objects.some(
    (object) =>
      !isRegistrationBox(object) &&
      operations.some((operation) => sceneObjectUsesOperation(object, operation)),
  );
}

function artworkOperations(scene: Scene, outputOnly: boolean): ReadonlyArray<Layer> {
  return scene.layers.filter(
    (operation) =>
      operation.id !== REGISTRATION_LAYER_ID && (!outputOnly || operation.output === true),
  );
}

// Which run the next Start will burn, derived from the registration layer's output
// vs the other layers'. Drives the jig panel's "Next burn" banner and the
// Box/Artwork segmented toggle (ADR-057). 'mixed' = not cleanly one run, i.e. both
// the box and artwork output, or neither does.
export type RegistrationRunState = 'none' | 'box' | 'artwork' | 'mixed';

export function registrationRunState(scene: Scene): RegistrationRunState {
  const layer = findRegistrationLayer(scene);
  if (layer === null || findRegistrationBoxes(scene).length === 0) return 'none';
  const artworkOutput = hasOutputRegistrationArtwork(scene);
  if (layer.output && !artworkOutput) return 'box';
  if (!layer.output && artworkOutput) return 'artwork';
  return 'mixed';
}

// True when a jig is present AND the registration box plus some other layer are
// both set to output — i.e. the next Start would burn the box and the artwork in
// the SAME pass, which defeats the two-run jig (the box re-burns over the placed
// object, or the art burns before the object is placed). Preflight blocks this so
// the operator picks one run (ADR-057).
export function registrationOutputConflict(scene: Scene): boolean {
  const layer = findRegistrationLayer(scene);
  if (layer === null || !layer.output || findRegistrationBoxes(scene).length === 0) return false;
  return hasOutputRegistrationArtwork(scene);
}
