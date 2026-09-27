// The shared studio environment for lit 3D views (ADR-102 lighting, shared
// by ADR-426). Image-based lighting from a small prefiltered light box gives
// metal and machined surfaces something to reflect, which is what makes a
// bit read as steel and a pocket wall read as a wall.

import type * as ThreeNamespace from 'three';
import type { Scene, WebGLRenderer } from 'three';

type ThreeModule = typeof ThreeNamespace;

const LIGHT_COLOR = 0xffffff;

/**
 * Prefilters the light box into an environment texture. The generator and
 * the source scene are disposed at once; only the texture is kept, and the
 * caller disposes it with the view.
 */
export function prefilteredRoomEnvironment(
  three: ThreeModule,
  renderer: WebGLRenderer,
  blurSigma: number,
): NonNullable<Scene['environment']> {
  const generator = new three.PMREMGenerator(renderer);
  const room = new three.Scene();
  const geometry = buildRoom(three, room);
  const target = generator.fromScene(room, blurSigma);
  generator.dispose();
  geometry.dispose();
  room.traverse((object) => {
    const material = (object as { material?: { dispose?: () => void } }).material;
    material?.dispose?.();
  });
  return target.texture;
}

// A minimal three-sided light box, standing in for the RoomEnvironment addon.
// Inlining it keeps the lazily-loaded 3D chunk from pulling in a second addon
// module for what amounts to five emissive boxes.
function buildRoom(three: ThreeModule, room: Scene): ThreeNamespace.BoxGeometry {
  const geometry = new three.BoxGeometry();
  const add = (
    intensity: number,
    scale: readonly [number, number, number],
    position: readonly [number, number, number],
  ): void => {
    const mesh = new three.Mesh(
      geometry,
      new three.MeshBasicMaterial({ color: LIGHT_COLOR, side: three.BackSide }),
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
  return geometry;
}
