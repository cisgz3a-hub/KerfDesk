// Studio playhead markers (ADR-426): the job's own bit in a collet and
// holder, or a diode laser head with its beam. Real size, lit by the Studio
// environment. The bit's cutting shape is core/sim's toolProfile, the same
// silhouette the cut simulation stamps with, so the drawing never shows a
// shape the job does not cut with.

import type * as ThreeNamespace from 'three';
import type { Group, Material } from 'three';
import type { StudioToolSpec } from './viewer3d-look';

type ThreeModule = typeof ThreeNamespace;
type Profile = ReadonlyArray<readonly [number, number]>;

const LATHE_SEGMENTS = 48;
const SHANK_LENGTH_MM = 18;
const NUT_HEIGHT_MM = 10;
const HOLDER_PROFILE: Profile = [
  [6.8, 0],
  [8.6, 2],
  [8.6, 12],
  [9.2, 12.6],
  [11, 15],
  [11, 32],
  [10.4, 33],
  [0, 33],
];

/** Builds the Studio marker, tip (or laser focus) at the local origin; null for 'none'. */
export function buildStudioTool(three: ThreeModule, spec: StudioToolSpec): Group | null {
  if (spec.kind === 'none') return null;
  const group = spec.kind === 'laser' ? laserHead(three) : bitInHolder(three, spec);
  group.traverse((object) => {
    object.renderOrder = 5;
  });
  return group;
}

function bitInHolder(
  three: ThreeModule,
  spec: Extract<StudioToolSpec, { readonly kind: 'bit' }>,
): Group {
  const group = new three.Group();
  const carbide = metal(three, 0x9aa0a8, 0.3);
  const polished = metal(three, 0xdfe3e8, 0.14);
  const cutter = spec.profile.map((point) => [point.radiusMm, point.heightMm] as const);
  const cutterTop = cutter.at(-1)?.[1] ?? 0;
  const cutterRadius = Math.max(0.1, ...cutter.map(([radius]) => radius));
  const shankRadius = Math.max(cutterRadius, spec.shankDiameterMm / 2);
  group.add(lathe(three, [[0, 0], ...cutter, [0, cutterTop]], carbide, 0));
  let top = cutterTop;
  group.add(
    lathe(
      three,
      [
        [shankRadius, 0],
        [shankRadius, SHANK_LENGTH_MM],
      ],
      polished,
      top,
    ),
  );
  top += SHANK_LENGTH_MM;
  const nutRadius = Math.max(8.2, shankRadius + 3);
  group.add(
    lathe(
      three,
      [
        [shankRadius + 0.4, 0],
        [nutRadius - 2, 0],
        [nutRadius - 0.6, 1],
        [nutRadius, 2],
        [nutRadius, 9],
        [nutRadius - 0.8, NUT_HEIGHT_MM],
        [nutRadius - 1.4, NUT_HEIGHT_MM],
      ],
      metal(three, 0x8a9099, 0.3),
      top,
    ),
  );
  top += NUT_HEIGHT_MM;
  const holderScale = nutRadius / 8.2;
  group.add(
    lathe(
      three,
      HOLDER_PROFILE.map(([radius, height]) => [radius * holderScale, height] as const),
      metal(three, 0x5a616b, 0.28),
      top,
    ),
  );
  const band = lathe(
    three,
    [
      [11.05 * holderScale, 22],
      [11.05 * holderScale, 24.5],
    ],
    new three.MeshStandardMaterial({ color: 0xc46e3a, metalness: 0.4, roughness: 0.35 }),
    top,
  );
  group.add(band);
  return group;
}

function laserHead(three: ThreeModule): Group {
  const group = new three.Group();
  const anodised = metal(three, 0x3a3e45, 0.36, 0.7);
  const cover = new three.MeshStandardMaterial({ color: 0x24272c, metalness: 0.2, roughness: 0.5 });
  const nozzleZ = 8;
  group.add(
    lathe(
      three,
      [
        [1.1, 0],
        [1.8, 0],
        [3.6, 6],
        [4.4, 6],
        [4.4, 9],
        [0, 9],
      ],
      metal(three, 0xcfd3d9, 0.22),
      nozzleZ,
    ),
  );
  const base = nozzleZ + 9;
  group.add(box(three, [22, 20, 2], anodised, base + 1));
  for (let fin = 0; fin < 8; fin += 1) {
    const plate = box(three, [22, 0.9, 15], anodised, base + 9.5);
    plate.position.y = -8.75 + fin * 2.5;
    group.add(plate);
  }
  group.add(
    box(
      three,
      [23, 21, 1],
      new three.MeshStandardMaterial({ color: 0xc46e3a, metalness: 0.3, roughness: 0.4 }),
      base + 17.5,
    ),
  );
  group.add(box(three, [23, 21, 12], cover, base + 24));
  group.add(beam(three, nozzleZ));
  return group;
}

// The beam from nozzle to focus: a bright core in a faint cone.
function beam(three: ThreeModule, lengthMm: number): Group {
  const glow = (
    color: number,
    opacity: number,
    top: number,
    bottom: number,
  ): ThreeNamespace.Mesh => {
    const mesh = new three.Mesh(
      new three.CylinderGeometry(top, bottom, lengthMm, 16, 1, true),
      new three.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: three.AdditiveBlending,
        depthWrite: false,
        side: three.DoubleSide,
        toneMapped: false,
      }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = lengthMm / 2;
    return mesh;
  };
  const group = new three.Group();
  group.add(glow(0xa8b8ff, 0.95, 0.07, 0.05), glow(0x6070ff, 0.16, 0.9, 0.1));
  return group;
}

function lathe(
  three: ThreeModule,
  profile: Profile,
  material: Material,
  baseZ: number,
): ThreeNamespace.Mesh {
  const geometry = new three.LatheGeometry(
    profile.map(([radius, height]) => new three.Vector2(radius, height)),
    LATHE_SEGMENTS,
  );
  // LatheGeometry revolves around +Y; stand it up into the Z-up frame.
  geometry.rotateX(Math.PI / 2);
  const mesh = new three.Mesh(geometry, material);
  mesh.position.z = baseZ;
  return mesh;
}

function box(
  three: ThreeModule,
  size: readonly [number, number, number],
  material: Material,
  centreZ: number,
): ThreeNamespace.Mesh {
  const mesh = new three.Mesh(new three.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.z = centreZ;
  return mesh;
}

function metal(
  three: ThreeModule,
  color: number,
  roughness: number,
  metalness = 1,
): ThreeNamespace.MeshStandardMaterial {
  return new three.MeshStandardMaterial({ color, metalness, roughness });
}
