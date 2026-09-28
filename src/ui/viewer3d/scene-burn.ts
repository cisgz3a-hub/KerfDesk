// The laser burn preview in the G-code 3D view (ADR-487): the sheet a laser
// program burns, darkened where playback has burned it, or on a rotary the
// work it turns, wrapped round. The darkness is one byte a cell in a texture
// the burn worker fills (burn-grid.ts); a burn only rewrites the texture.
//
// The sheet is drawn in the carved stock's materials (scene-stock-materials.ts)
// at its top face, and each burns as that material does: wood and MDF scorch
// brown, then char black; acrylic frosts pale; aluminium marks dark; the
// two-colour laminate loses its cap and shows its core; flat grey darkens;
// the height map colours the burn itself, pale unburned to dark blue black.

import type * as ThreeNamespace from 'three';
import { classicLights } from './scene-stock';
import {
  applyStockMaterial,
  createStockUniforms,
  STOCK_MATERIAL_GLSL,
  type StockUniforms,
} from './scene-stock-materials';
import type { StockMaterialChoice } from './scene-stock';
import type { Viewer3dLook } from './viewer3d-look';

type ThreeModule = typeof ThreeNamespace;

/** The burn, in the program's frame (ADR-487). */
export type Viewer3dBurn = {
  /** Machine X and Y of the first cell's corner. */
  readonly originX: number;
  readonly originY: number;
  readonly mmPerCell: number;
  readonly columns: number;
  readonly rows: number;
  /** Each cell's darkness, 0 bare to 255 black, row by row from the front. */
  readonly darkness: Uint8Array;
  /** The height the laser burns at. */
  readonly z: number;
  /** Wrapped round a rotary: the work's diameter; the rows go once round it. */
  readonly wrapDiameterMm?: number;
};

export type BurnView = {
  readonly set: (burn: Viewer3dBurn | null) => void;
  /** The darkness changed: uploads it. */
  readonly update: () => void;
  readonly setLook: (look: Viewer3dLook) => void;
  readonly setMaterial: (choice: StockMaterialChoice) => void;
  readonly dispose: () => void;
};

// The sheet sits this far under the burned moves, so they draw over it.
const UNDER_MM = 0.02;
const ROUND_SEGMENTS = 256;

export function createBurnView(three: ThreeModule, scene: ThreeNamespace.Scene): BurnView {
  const root = new three.Group();
  root.name = 'laser-burn';
  const lights = classicLights(three);
  root.add(lights);
  root.visible = false;
  scene.add(root);
  let built: BuiltBurn | null = null;
  let look: Viewer3dLook = 'classic';
  let material: StockMaterialChoice = { material: 'wood' };
  const shade = (): void => {
    if (built !== null) applyStockMaterial(built.uniforms, [built.mesh.material], material, look);
  };
  const clear = (): void => {
    if (built === null) return;
    root.remove(built.mesh);
    built.dispose();
    built = null;
  };
  return {
    set: (burn) => {
      clear();
      root.visible = burn !== null;
      if (burn === null) return;
      built = buildBurn(three, burn);
      root.add(built.mesh);
      shade();
    },
    update: () => {
      if (built !== null) built.texture.needsUpdate = true;
    },
    setLook: (next) => {
      look = next;
      lights.visible = look === 'classic';
      shade();
    },
    setMaterial: (next) => {
      material = next;
      shade();
    },
    dispose: () => {
      clear();
      scene.remove(root);
    },
  };
}

type BurnMesh = ThreeNamespace.Mesh<
  ThreeNamespace.BufferGeometry,
  ThreeNamespace.MeshStandardMaterial
>;

type BuiltBurn = {
  readonly mesh: BurnMesh;
  readonly texture: ThreeNamespace.DataTexture;
  readonly uniforms: StockUniforms;
  readonly dispose: () => void;
};

function buildBurn(three: ThreeModule, burn: Viewer3dBurn): BuiltBurn {
  const texture = new three.DataTexture(
    burn.darkness,
    burn.columns,
    burn.rows,
    three.RedFormat,
    three.UnsignedByteType,
  );
  // One byte a cell: rows are not padded to four bytes.
  texture.unpackAlignment = 1;
  texture.minFilter = three.LinearFilter;
  texture.magFilter = three.LinearFilter;
  // Round a rotary the rows join up; along X, and on a sheet, they stop.
  texture.wrapT =
    burn.wrapDiameterMm === undefined ? three.ClampToEdgeWrapping : three.RepeatWrapping;
  texture.needsUpdate = true;
  const width = burn.columns * burn.mmPerCell;
  const length = burn.rows * burn.mmPerCell;
  const uniforms = createStockUniforms({
    // The height map shades the burn itself from 0 to 1.
    bottomZ: -1,
    centreX: burn.originX + width / 2,
    centreY: burn.originY + length / 2,
    lengthY: length,
  });
  const geometry =
    burn.wrapDiameterMm === undefined
      ? sheetGeometry(three, burn, width, length)
      : roundGeometry(three, burn, width, length, burn.wrapDiameterMm / 2);
  const material = new three.MeshStandardMaterial({ color: 0xffffff });
  const shared = {
    ...uniforms,
    burnDarkness: { value: texture },
    burnOrigin: { value: [burn.originX, burn.originY] },
    burnSize: { value: [width, length] },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = burnVertex(shader.vertexShader);
    shader.fragmentShader = burnFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => 'laser-burn';
  const mesh = new three.Mesh(geometry, material);
  mesh.name = burn.wrapDiameterMm === undefined ? 'laser-burn-sheet' : 'laser-burn-round';
  return {
    mesh,
    texture,
    uniforms,
    dispose: () => {
      texture.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

// A flat sheet under the burn, its texture across it from the first cell.
function sheetGeometry(
  three: ThreeModule,
  burn: Viewer3dBurn,
  width: number,
  length: number,
): ThreeNamespace.BufferGeometry {
  const geometry = new three.PlaneGeometry(width, length);
  geometry.translate(burn.originX + width / 2, burn.originY + length / 2, burn.z - UNDER_MM);
  return geometry;
}

/**
 * The work round a rotary: a cylinder along X whose top is at the burn's
 * height, the texture's rows once round it. The middle of the rows is at the
 * top and program Y runs on over the back, as the surface does under the
 * laser; the ends are closed with the unburned surface.
 */
export function roundGeometry(
  three: ThreeModule,
  burn: Pick<Viewer3dBurn, 'originX' | 'originY' | 'z'>,
  width: number,
  length: number,
  radius: number,
): ThreeNamespace.BufferGeometry {
  const centreY = burn.originY + length / 2;
  const centreZ = burn.z - UNDER_MM - radius;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let step = 0; step <= ROUND_SEGMENTS; step += 1) {
    const v = step / ROUND_SEGMENTS;
    const angle = 2 * Math.PI * (v - 0.5);
    for (const end of [0, 1]) {
      positions.push(
        burn.originX + end * width,
        centreY + radius * Math.sin(angle),
        centreZ + radius * Math.cos(angle),
      );
      normals.push(0, Math.sin(angle), Math.cos(angle));
      uvs.push(end, v);
    }
  }
  for (let step = 0; step < ROUND_SEGMENTS; step += 1) {
    const a = step * 2;
    // a and a + 1 go along X; a + 2 and a + 3 are the next step round.
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  closeEnds({ positions, normals, uvs, index }, burn.originX, width, centreY, centreZ, radius);
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new three.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new three.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

type MeshArrays = { positions: number[]; normals: number[]; uvs: number[]; index: number[] };

// A disc at each end, facing out, drawn from the unburned margin's corner.
function closeEnds(
  mesh: MeshArrays,
  originX: number,
  width: number,
  centreY: number,
  centreZ: number,
  radius: number,
): void {
  for (const [x, facing] of [
    [originX, -1],
    [originX + width, 1],
  ] as const) {
    const centre = mesh.positions.length / 3;
    mesh.positions.push(x, centreY, centreZ);
    mesh.normals.push(facing, 0, 0);
    mesh.uvs.push(0, 0);
    for (let step = 0; step < ROUND_SEGMENTS; step += 1) {
      const angle = (2 * Math.PI * step) / ROUND_SEGMENTS;
      mesh.positions.push(
        x,
        centreY + radius * Math.sin(angle),
        centreZ + radius * Math.cos(angle),
      );
      mesh.normals.push(facing, 0, 0);
      mesh.uvs.push(0, 0);
      const here = centre + 1 + step;
      const following = centre + 1 + ((step + 1) % ROUND_SEGMENTS);
      if (facing > 0) mesh.index.push(centre, following, here);
      else mesh.index.push(centre, here, following);
    }
  }
}

// Where each point is on the unrolled surface, from its texture place.
function burnVertex(source: string): string {
  return `uniform vec2 burnOrigin;
uniform vec2 burnSize;
varying vec2 vBurnUv;
varying vec3 vStockPoint;
${source}`.replace(
    '#include <project_vertex>',
    `vBurnUv = uv;
vStockPoint = vec3(burnOrigin + uv * burnSize, 0.0);
#include <project_vertex>`,
  );
}

function burnFragment(source: string): string {
  return `${STOCK_MATERIAL_GLSL}
${BURN_GLSL}
${source}`
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
float burnHere = texture2D(burnDarkness, vBurnUv).r;
diffuseColor.rgb = burnColour(stockColour(vStockPoint), burnHere) * stockGain;`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
roughnessFactor = mix(stockRoughness(vStockPoint, roughnessFactor), burnRough(), burnHere);`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
metalnessFactor *= 1.0 - burnHere;`,
    );
}

// How each material burns, by stockKind (scene-stock-materials.ts). Linear colours.
const BURN_GLSL = `uniform sampler2D burnDarkness;
varying vec2 vBurnUv;
vec3 burnColour(vec3 surface, float d) {
  if (stockKind <= 1) {
    vec3 scorch = stockKind == 0 ? vec3(0.30, 0.13, 0.04) : vec3(0.16, 0.07, 0.03);
    vec3 colour = mix(surface, scorch, smoothstep(0.0, 0.5, d));
    return mix(colour, vec3(0.018, 0.013, 0.010), smoothstep(0.4, 1.0, d));
  }
  if (stockKind == 2) return mix(surface, vec3(0.62, 0.72, 0.80), d);
  if (stockKind == 3) return mix(surface, vec3(0.16, 0.16, 0.17), d);
  if (stockKind == 4) return mix(surface, vec3(0.80, 0.80, 0.77), d);
  if (stockKind == 5) return mix(surface, vec3(0.06), d);
  return stockHeight(vec3(0.0, 0.0, -d));
}
float burnRough() {
  if (stockKind == 3) return 0.6;
  if (stockKind == 2) return 0.7;
  return 0.92;
}
`;
