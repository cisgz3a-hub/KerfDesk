// The carved stock in the G-code 3D view (ADR-487): a block of material whose
// top is the removal grid the carving simulator fills as playback runs. The
// top is one flat grid of vertices, one per cell, raised or lowered in the
// vertex shader from a float texture of the cells' depths, with its normals
// taken from the neighbouring cells. Carving then only rewrites the texture:
// nothing is rebuilt as the stock changes. The sides and bottom are plain
// faces from the stock's bottom to its top. Cells cut below the bottom are
// cut through and draw nothing, so a profile leaves a hole.
//
// Compared with the design, the top is coloured by how far each cell is from
// the depth the design wants there (scene-stock-compare.ts). The top casts
// soft shadows into the carving and darkens its hollows, from the same depths
// (scene-stock-shade.ts).
//
// Classic has no lights of its own, so the stock brings a soft rig of its
// own there; Studio's lights and environment light it in Studio. Classic's
// grid lies at Z0, the stock's top, so while the stock shows the grid drops
// to the stock's bottom and the block sits on it; it goes back after.

import type * as ThreeNamespace from 'three';
import {
  createCompareUniforms,
  stockCompareFragment,
  type StockCompareUniforms,
} from './scene-stock-compare';
import {
  applyStockMaterial,
  createStockUniforms,
  stockFragmentChunks,
  stockVertexChunks,
  type StockMaterial,
  type StockUniforms,
} from './scene-stock-materials';
import {
  applyStockShade,
  CLASSIC_KEY_DIRECTION,
  createShadeUniforms,
  stockShadeFragment,
  type StockShadeUniforms,
} from './scene-stock-shade';
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
  /** Each cell's Z, 0 at the stock top and negative below, row by row from the front. */
  readonly depth: Float32Array;
  /** The stock's bottom, below Z0. */
  readonly bottomZ: number;
  /**
   * The depth the design wants in each cell, laid out as `depth`, and above
   * Z0 where there is no design to compare with; absent without a design.
   */
  readonly target?: Float32Array;
};

/** What the stock is made of: a material, and the project's stock for wood. */
export type StockMaterialChoice = {
  readonly material: StockMaterial;
  /** The project's stock material (a CNC material key), for its species. */
  readonly materialKey?: string | undefined;
};

export type StockView = {
  readonly set: (stock: Viewer3dStock | null) => void;
  /** The depths changed: uploads them. */
  readonly update: () => void;
  readonly setLook: (look: Viewer3dLook) => void;
  readonly setMaterial: (choice: StockMaterialChoice) => void;
  /** Colours the top against the design within the tolerance, or stops. */
  readonly setCompare: (toleranceMm: number | null) => void;
  /** Shadows and occlusion on the top, or none. */
  readonly setShaded: (shaded: boolean) => void;
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
  let material: StockMaterialChoice = { material: 'wood' };
  let compare: number | null = null;
  let shaded = true;
  let gridZ = 0;
  const shade = (): void => {
    if (built === null) return;
    applyStockMaterial(built.uniforms, built.materials, material, look);
    built.compare.stockCompare.value = compare === null ? 0 : 1;
    built.compare.stockTolerance.value = compare ?? 0;
    applyStockShade(built.shade, shaded, look);
  };
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
    setCompare: (toleranceMm) => {
      compare = toleranceMm;
      shade();
    },
    setShaded: (next) => {
      shaded = next;
      shade();
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
  readonly uniforms: StockUniforms;
  readonly compare: StockCompareUniforms;
  readonly shade: StockShadeUniforms;
  readonly materials: ReadonlyArray<ThreeNamespace.MeshStandardMaterial>;
  readonly dispose: () => void;
};

function buildStock(three: ThreeModule, stock: Viewer3dStock): BuiltStock {
  const texture = cellTexture(three, stock.depth, stock.columns, stock.rows);
  // A cell above Z0 has no design to compare with: one of them stands for none.
  const target =
    stock.target === undefined
      ? cellTexture(three, new Float32Array([1]), 1, 1)
      : cellTexture(three, stock.target, stock.columns, stock.rows);
  const lengthY = stock.rows * stock.mmPerCell;
  const uniforms = createStockUniforms({
    bottomZ: stock.bottomZ,
    centreX: stock.originX + (stock.columns * stock.mmPerCell) / 2,
    centreY: stock.originY + lengthY / 2,
    lengthY,
  });
  const compare = createCompareUniforms(target);
  const shade = createShadeUniforms();
  const top = topMesh(three, stock, texture, { ...uniforms, ...compare, ...shade });
  const sides = sideMesh(three, stock, uniforms);
  const group = new three.Group();
  group.add(top, sides);
  return {
    group,
    texture,
    uniforms,
    compare,
    shade,
    materials: [top.material, sides.material],
    dispose: () => {
      texture.dispose();
      target.dispose();
      for (const mesh of [top, sides]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}

// One float a cell, read exactly: no filtering between cells.
function cellTexture(
  three: ThreeModule,
  cells: Float32Array,
  columns: number,
  rows: number,
): ThreeNamespace.DataTexture {
  const texture = new three.DataTexture(cells, columns, rows, three.RedFormat, three.FloatType);
  texture.minFilter = three.NearestFilter;
  texture.magFilter = three.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

type StockMesh = ThreeNamespace.Mesh<
  ThreeNamespace.BufferGeometry,
  ThreeNamespace.MeshStandardMaterial
>;

// One vertex per cell centre, from the first to the last.
function topMesh(
  three: ThreeModule,
  stock: Viewer3dStock,
  texture: ThreeNamespace.DataTexture,
  shared: StockUniforms & StockCompareUniforms & StockShadeUniforms,
): StockMesh {
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
  const material = stockMaterial(three);
  const uniforms = {
    ...shared,
    stockDepth: { value: texture },
    stockCell: { value: stock.mmPerCell },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = stockVertexChunks(carveVertex(shader.vertexShader));
    // The top's declarations come first, for the compare and shade functions.
    shader.fragmentShader = carveFragment(
      stockCompareFragment(stockShadeFragment(stockFragmentChunks(shader.fragmentShader))),
    );
  };
  material.customProgramCacheKey = () => 'carved-stock-top';
  const mesh = new three.Mesh(geometry, material);
  // The vertex shader moves the surface, so three's bounds would be wrong.
  mesh.frustumCulled = false;
  return mesh;
}

// The four sides and the bottom, around the cells from edge to edge.
function sideMesh(three: ThreeModule, stock: Viewer3dStock, shared: StockUniforms): StockMesh {
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
  const material = stockMaterial(three);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = stockVertexChunks(shader.vertexShader);
    shader.fragmentShader = stockFragmentChunks(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => 'carved-stock-sides';
  return new three.Mesh(geometry, material);
}

// White, so the shader's colour is the colour drawn.
function stockMaterial(three: ThreeModule): ThreeNamespace.MeshStandardMaterial {
  return new three.MeshStandardMaterial({ color: 0xffffff });
}

// Raises each vertex to its cell's depth and takes its normal from the cells
// either side, clamped at the edges.
function carveVertex(source: string): string {
  const header = `uniform sampler2D stockDepth;
uniform float stockCell;
uniform float stockBottom;
varying float vStockDepth;
varying vec2 vStockUv;
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
vStockUv = uv;
vec3 transformed = vec3(position.xy, max(vStockDepth, stockBottom));`,
    );
}

// stockBottom comes with the material's own uniforms (scene-stock-materials.ts).
function carveFragment(source: string): string {
  return `uniform sampler2D stockDepth;
uniform float stockCell;
varying float vStockDepth;
varying vec2 vStockUv;
${source}`.replace(
    '#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>
if (vStockDepth < stockBottom - ${THROUGH_MM.toFixed(4)}) discard;`,
  );
}

/** A sky and ground fill with a key light from the front left, for Classic. */
export function classicLights(three: ThreeModule): ThreeNamespace.Group {
  const group = new three.Group();
  const fill = new three.HemisphereLight(0xe8ecf2, 0x3a3632, 1.1);
  fill.position.set(0, 0, 1);
  const key = new three.DirectionalLight(0xfff6ec, 1.6);
  key.position.set(...CLASSIC_KEY_DIRECTION);
  group.add(fill, key);
  return group;
}
