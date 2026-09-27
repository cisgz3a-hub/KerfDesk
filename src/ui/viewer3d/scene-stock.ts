// The carved stock in the G-code 3D view (ADR-487): a block of material whose
// top is the removal grid the carving simulator fills as playback runs. The
// top is one flat grid of vertices, one per cell, raised or lowered in the
// vertex shader from a float texture of the cells' depths, with its normals
// taken from the neighbouring cells. Carving then only rewrites the texture:
// nothing is rebuilt as the stock changes. The sides and bottom are plain
// faces from the stock's bottom to its top. Cells cut below the bottom are
// cut through and draw nothing, so a profile leaves a hole.
//
// Classic has no lights of its own, so the stock brings a soft rig of its
// own there; Studio's lights and environment light it in Studio. Classic's
// grid lies at Z0, the stock's top, so while the stock shows the grid drops
// to the stock's bottom and the block sits on it; it goes back after.

import type * as ThreeNamespace from 'three';
import type { Viewer3dLook } from './viewer3d-look';

type ThreeModule = typeof ThreeNamespace;

/** The stock's top, as the carving simulator fills it (ADR-487). */
export type Viewer3dStock = {
  /** Machine X and Y of the first cell's corner. */
  readonly originX: number;
  readonly originY: number;
  readonly mmPerCell: number;
  readonly columns: number;
  readonly rows: number;
  /** Depth of each cell below the stock top (Z0), row by row from the front. */
  readonly depth: Float32Array;
  /** The stock's bottom, below Z0. */
  readonly bottomZ: number;
  /** The colour of the material. */
  readonly color: number;
};

export type StockView = {
  readonly set: (stock: Viewer3dStock | null) => void;
  /** The depths changed: uploads them. */
  readonly update: () => void;
  readonly setLook: (look: Viewer3dLook) => void;
  /** Classic's grid was built again: puts it under the stock. */
  readonly placeGrid: () => void;
  readonly dispose: () => void;
};

// A cell this far below the bottom counts as cut through.
const THROUGH_MM = 1e-3;

export function createStockView(
  three: ThreeModule,
  scene: ThreeNamespace.Scene,
  classicFurniture: ThreeNamespace.Object3D,
): StockView {
  const root = new three.Group();
  root.name = 'carved-stock';
  const lights = classicLights(three);
  root.add(lights);
  scene.add(root);
  let built: BuiltStock | null = null;
  let look: Viewer3dLook = 'classic';
  let gridZ = 0;
  const placeGrid = (): void => {
    for (const child of classicFurniture.children) {
      if (child.type === 'GridHelper') child.position.z = gridZ;
    }
  };
  const clear = (): void => {
    if (built === null) return;
    root.remove(built.group);
    built.dispose();
    built = null;
  };
  return {
    set: (stock) => {
      clear();
      root.visible = stock !== null;
      gridZ = stock?.bottomZ ?? 0;
      placeGrid();
      if (stock === null) return;
      built = buildStock(three, stock);
      root.add(built.group);
    },
    update: () => {
      if (built !== null) built.texture.needsUpdate = true;
    },
    setLook: (next) => {
      look = next;
      lights.visible = look === 'classic';
    },
    placeGrid,
    dispose: () => {
      clear();
      scene.remove(root);
    },
  };
}

type BuiltStock = {
  readonly group: ThreeNamespace.Group;
  readonly texture: ThreeNamespace.DataTexture;
  readonly dispose: () => void;
};

function buildStock(three: ThreeModule, stock: Viewer3dStock): BuiltStock {
  const texture = new three.DataTexture(
    stock.depth,
    stock.columns,
    stock.rows,
    three.RedFormat,
    three.FloatType,
  );
  texture.minFilter = three.NearestFilter;
  texture.magFilter = three.NearestFilter;
  texture.needsUpdate = true;
  const top = topMesh(three, stock, texture);
  const sides = sideMesh(three, stock);
  const group = new three.Group();
  group.add(top, sides);
  return {
    group,
    texture,
    dispose: () => {
      texture.dispose();
      for (const mesh of [top, sides]) {
        mesh.geometry.dispose();
        (mesh.material as ThreeNamespace.Material).dispose();
      }
    },
  };
}

// One vertex per cell centre, from the first to the last.
function topMesh(
  three: ThreeModule,
  stock: Viewer3dStock,
  texture: ThreeNamespace.DataTexture,
): ThreeNamespace.Mesh {
  const spanX = Math.max(stock.columns - 1, 1) * stock.mmPerCell;
  const spanY = Math.max(stock.rows - 1, 1) * stock.mmPerCell;
  const geometry = new three.PlaneGeometry(
    spanX,
    spanY,
    Math.max(stock.columns - 1, 1),
    Math.max(stock.rows - 1, 1),
  );
  geometry.translate(
    stock.originX + stock.mmPerCell / 2 + spanX / 2,
    stock.originY + stock.mmPerCell / 2 + spanY / 2,
    0,
  );
  const material = stockMaterial(three, stock.color);
  const uniforms = {
    stockDepth: { value: texture },
    stockCell: { value: stock.mmPerCell },
    stockBottom: { value: stock.bottomZ },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = carveVertex(shader.vertexShader);
    shader.fragmentShader = carveFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => 'carved-stock-top';
  const mesh = new three.Mesh(geometry, material);
  // The vertex shader moves the surface, so three's bounds would be wrong.
  mesh.frustumCulled = false;
  return mesh;
}

// The four sides and the bottom, around the cells from edge to edge.
function sideMesh(three: ThreeModule, stock: Viewer3dStock): ThreeNamespace.Mesh {
  const width = stock.columns * stock.mmPerCell;
  const depth = stock.rows * stock.mmPerCell;
  const height = -stock.bottomZ;
  const geometry = new three.BoxGeometry(width, depth, height);
  // The box's top face would hide the carving: keep the sides and bottom.
  const index = geometry.getIndex();
  if (index !== null) {
    const kept = Array.from(index.array).filter((_, at) => at < 24 || at >= 30);
    geometry.setIndex(kept);
    geometry.clearGroups();
  }
  geometry.translate(stock.originX + width / 2, stock.originY + depth / 2, stock.bottomZ / 2);
  return new three.Mesh(geometry, stockMaterial(three, stock.color));
}

function stockMaterial(three: ThreeModule, color: number): ThreeNamespace.MeshStandardMaterial {
  return new three.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 });
}

// Raises each vertex to its cell's depth and takes its normal from the cells
// either side, clamped at the edges.
function carveVertex(source: string): string {
  const header = `uniform sampler2D stockDepth;
uniform float stockCell;
uniform float stockBottom;
varying float vStockDepth;
float stockDepthAt(ivec2 cell) {
  ivec2 size = textureSize(stockDepth, 0);
  return texelFetch(stockDepth, clamp(cell, ivec2(0), size - 1), 0).r;
}
ivec2 stockCellOf(vec2 uv) {
  ivec2 size = textureSize(stockDepth, 0);
  return ivec2(round(uv * vec2(size - 1)));
}
`;
  return (header + source)
    .replace(
      '#include <beginnormal_vertex>',
      `ivec2 stockCellHere = stockCellOf(uv);
float stockLeft = stockDepthAt(stockCellHere - ivec2(1, 0));
float stockRight = stockDepthAt(stockCellHere + ivec2(1, 0));
float stockFront = stockDepthAt(stockCellHere - ivec2(0, 1));
float stockBack = stockDepthAt(stockCellHere + ivec2(0, 1));
vec3 objectNormal = normalize(vec3(
  (stockLeft - stockRight) / (2.0 * stockCell),
  (stockFront - stockBack) / (2.0 * stockCell),
  1.0));`,
    )
    .replace(
      '#include <begin_vertex>',
      `vStockDepth = stockDepthAt(stockCellHere);
vec3 transformed = vec3(position.xy, max(vStockDepth, stockBottom));`,
    );
}

function carveFragment(source: string): string {
  return `uniform float stockBottom;
varying float vStockDepth;
${source}`.replace(
    '#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>
if (vStockDepth < stockBottom - ${THROUGH_MM.toFixed(4)}) discard;`,
  );
}

// A sky and ground fill with a key light from the front left, for Classic.
function classicLights(three: ThreeModule): ThreeNamespace.Group {
  const group = new three.Group();
  const fill = new three.HemisphereLight(0xe8ecf2, 0x3a3632, 1.1);
  fill.position.set(0, 0, 1);
  const key = new three.DirectionalLight(0xfff6ec, 1.6);
  key.position.set(-0.5, -0.8, 1);
  group.add(fill, key);
  return group;
}
