// DXF writer for vector artwork (ADR-431), written from the published
// Autodesk DXF reference: AC1018 (AutoCAD 2004) ASCII DXF, millimetres
// ($INSUNITS 4), one closed or open LWPOLYLINE per contour, one layer per
// artwork colour carrying both the nearest ACI (group 62) and the exact
// 24-bit true colour (group 420, 0x00RRGGBB).
//
// The file carries the minimal R13+ structure the reference requires of a
// drawing database: HEADER ($ACADVER, $HANDSEED), CLASSES, the nine symbol
// tables (with the mandatory ByBlock/ByLayer/Continuous linetypes, layer 0,
// Standard text and dimension styles, the ACAD application id and the model
// and paper space block records), both space blocks, ENTITIES and an OBJECTS
// root dictionary holding ACAD_GROUP. Every object has a unique handle and
// its owner handle (330).
//
// Geometry: the app's Y-down millimetre frame is mirrored to DXF's Y-up
// frame and translated so the drawing's lower-left corner (or a caller's
// chosen scene point) is the origin.
// Lines and circular arcs are exact (bulge); cubics and elliptical arcs are
// flattened within the stated tolerance (see core/vector-export/bulge-rings).

import { curveSubpathBounds, type CurveSubpath } from '../../core/scene';
import {
  curveToBulgeRing,
  DEFAULT_DXF_CURVE_TOLERANCE_MM,
  type BulgeVertex,
} from '../../core/vector-export/bulge-rings';
import {
  DEFAULT_EXPORT_PRECISION_MM,
  decimalGridAtMost,
  formatGridIndex,
  gridIndex,
  outwardOnGrid,
  type DecimalGrid,
} from '../../core/vector-export/decimal-grid';
import { aciToHex } from './dxf-colors';

export type DxfLayerGeometry = {
  /** Lowercase `#rrggbb`. */
  readonly color: string;
  /** World millimetres, Y down (the scene frame). */
  readonly curves: ReadonlyArray<CurveSubpath>;
};

export type DxfWriteOptions = {
  /** Maximum distance between a flattened cubic/ellipse and the true curve. */
  readonly curveToleranceMm?: number;
  /** Coordinate grid; each vertex moves by at most half a grid diagonal. */
  readonly precisionMm?: number;
  /**
   * Scene point that becomes the DXF origin. Default: the drawing's
   * lower-left corner (minimum X, maximum scene Y).
   */
  readonly origin?: { readonly x: number; readonly y: number };
};

export type DxfDocument = {
  readonly text: string;
  readonly polylineCount: number;
  readonly vertexCount: number;
  readonly layerNames: ReadonlyArray<string>;
};

type GridVertex = { readonly x: number; readonly y: number; readonly bulge: number };
type Polyline = {
  readonly layer: string;
  readonly aci: number;
  readonly rgb: number;
  readonly vertices: GridVertex[];
  readonly closed: boolean;
};

export function writeDxfDocument(
  layers: ReadonlyArray<DxfLayerGeometry>,
  options: DxfWriteOptions = {},
): DxfDocument {
  const tolerance = options.curveToleranceMm ?? DEFAULT_DXF_CURVE_TOLERANCE_MM;
  const grid = decimalGridAtMost(options.precisionMm ?? DEFAULT_EXPORT_PRECISION_MM);
  const drawn = layers
    .map((layer) => ({ ...layer, curves: layer.curves.filter((c) => c.segments.length > 0) }))
    .filter((layer) => layer.curves.length > 0);
  const extent = drawingExtent(drawn);
  if (extent === null) throw new Error('There is no vector geometry to write.');
  const origin = options.origin ?? { x: extent.minX, y: extent.maxY };
  const polylines: Polyline[] = [];
  const layerTable = new Map<string, { aci: number; rgb: number }>();
  for (const layer of drawn) {
    const rgb = parseHexColor(layer.color);
    const name = layerName(rgb);
    const aci = nearestAci(rgb);
    layerTable.set(name, { aci, rgb });
    for (const curve of layer.curves) {
      const ring = curveToBulgeRing(curve, tolerance);
      const vertices = gridVertices(ring.vertices, ring.closed, origin, grid);
      if (vertices.length >= 2)
        polylines.push({ layer: name, aci, rgb, vertices, closed: ring.closed });
    }
  }
  if (polylines.length === 0) throw new Error('There is no vector geometry to write.');
  const xRange = outwardOnGrid(extent.minX - origin.x, extent.maxX - origin.x, grid);
  const yRange = outwardOnGrid(origin.y - extent.maxY, origin.y - extent.minY, grid);
  const text = new DxfText(grid).document(layerTable, polylines, {
    min: { x: xRange.min, y: yRange.min },
    max: { x: xRange.max, y: yRange.max },
  });
  return {
    text,
    polylineCount: polylines.length,
    vertexCount: polylines.reduce((sum, p) => sum + p.vertices.length, 0),
    layerNames: [...layerTable.keys()],
  };
}

function drawingExtent(
  layers: ReadonlyArray<DxfLayerGeometry>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    for (const curve of layer.curves) {
      const b = curveSubpathBounds(curve);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

/** Mirror Y, move the origin, snap to the grid and drop zero-length edges. */
function gridVertices(
  vertices: ReadonlyArray<BulgeVertex>,
  closed: boolean,
  origin: { readonly x: number; readonly y: number },
  grid: DecimalGrid,
): GridVertex[] {
  const out: { x: number; y: number; bulge: number }[] = [];
  for (const vertex of vertices) {
    const x = gridIndex(vertex.x - origin.x, grid);
    const y = gridIndex(origin.y - vertex.y, grid);
    const last = out[out.length - 1];
    if (last !== undefined && last.x === x && last.y === y) {
      // The edge collapsed; the next edge starts here with this vertex's bulge.
      last.bulge = vertex.bulge;
      continue;
    }
    out.push({ x, y, bulge: vertex.bulge });
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (
    closed &&
    out.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y
  ) {
    // The closed flag draws the final edge; the previous vertex keeps its bulge.
    out.pop();
  }
  return out;
}

function parseHexColor(color: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  return match === null ? 0 : Number.parseInt(match[1] as string, 16);
}

function layerName(rgb: number): string {
  return 'RGB_' + rgb.toString(16).padStart(6, '0').toUpperCase();
}

function nearestAci(rgb: number): number {
  let best = 7;
  let bestDistance = Infinity;
  for (let index = 1; index <= 255; index += 1) {
    const candidate = parseHexColor(aciToHex(index));
    const distance =
      ((rgb >> 16) - (candidate >> 16)) ** 2 +
      (((rgb >> 8) & 255) - ((candidate >> 8) & 255)) ** 2 +
      ((rgb & 255) - (candidate & 255)) ** 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** Stateful group-code emitter with a monotonically increasing handle seed. */
class DxfText {
  private readonly lines: string[] = [];
  private nextHandle = 1;

  constructor(private readonly grid: DecimalGrid) {}

  document(
    layers: ReadonlyMap<string, { readonly aci: number; readonly rgb: number }>,
    polylines: ReadonlyArray<Polyline>,
    extent: {
      readonly min: { readonly x: number; readonly y: number };
      readonly max: { readonly x: number; readonly y: number };
    },
  ): string {
    const body = new DxfText(this.grid);
    const spaces = body.tables(layers);
    body.blocks(spaces);
    body.entities(polylines, spaces.model);
    body.objects();
    this.section('HEADER');
    this.variable('$ACADVER', 1, 'AC1018');
    this.variable('$HANDSEED', 5, hex(body.nextHandle));
    this.variable('$INSUNITS', 70, '4');
    this.variable('$MEASUREMENT', 70, '1');
    this.pair(9, '$EXTMIN').point(extent.min.x, extent.min.y);
    this.pair(9, '$EXTMAX').point(extent.max.x, extent.max.y);
    this.pair(0, 'ENDSEC');
    this.section('CLASSES').pair(0, 'ENDSEC');
    return [...this.lines, ...body.lines, '  0', 'EOF', ''].join('\n');
  }

  private tables(layers: ReadonlyMap<string, { readonly aci: number; readonly rgb: number }>): {
    model: string;
    paper: string;
  } {
    this.section('TABLES');
    this.emptyTable('VPORT');
    const ltype = this.table('LTYPE', 3);
    for (const [name, description] of [
      ['ByBlock', ''],
      ['ByLayer', ''],
      ['Continuous', 'Solid line'],
    ] as const) {
      this.record('LTYPE', ltype, 'AcDbLinetypeTableRecord');
      this.pair(2, name)
        .pair(70, '0')
        .pair(3, description)
        .pair(72, '65')
        .pair(73, '0')
        .pair(40, '0.0');
    }
    this.pair(0, 'ENDTAB');
    const layer = this.table('LAYER', layers.size + 1);
    this.layerRecord(layer, '0', 7, null);
    for (const [name, colour] of layers) this.layerRecord(layer, name, colour.aci, colour.rgb);
    this.pair(0, 'ENDTAB');
    const style = this.table('STYLE', 1);
    this.record('STYLE', style, 'AcDbTextStyleTableRecord');
    this.pair(2, 'Standard')
      .pair(70, '0')
      .pair(40, '0.0')
      .pair(41, '1.0')
      .pair(50, '0.0')
      .pair(71, '0')
      .pair(42, '2.5');
    this.pair(3, 'txt').pair(4, '').pair(0, 'ENDTAB');
    this.emptyTable('VIEW');
    this.emptyTable('UCS');
    const appid = this.table('APPID', 1);
    this.record('APPID', appid, 'AcDbRegAppTableRecord');
    this.pair(2, 'ACAD').pair(70, '0').pair(0, 'ENDTAB');
    this.dimstyleTable();
    const blockRecords = this.table('BLOCK_RECORD', 2);
    const model = this.record('BLOCK_RECORD', blockRecords, 'AcDbBlockTableRecord');
    this.pair(2, '*Model_Space');
    const paper = this.record('BLOCK_RECORD', blockRecords, 'AcDbBlockTableRecord');
    this.pair(2, '*Paper_Space').pair(0, 'ENDTAB').pair(0, 'ENDSEC');
    return { model, paper };
  }

  private dimstyleTable(): void {
    const table = this.handle();
    const record = this.handle();
    this.pair(0, 'TABLE').pair(2, 'DIMSTYLE').pair(5, table).pair(330, '0');
    this.pair(100, 'AcDbSymbolTable').pair(70, '1').pair(100, 'AcDbDimStyleTable').pair(71, '1');
    this.pair(340, record);
    // DIMSTYLE records carry their handle in group 105, not 5.
    this.pair(0, 'DIMSTYLE').pair(105, record).pair(330, table);
    this.pair(100, 'AcDbSymbolTableRecord').pair(100, 'AcDbDimStyleTableRecord');
    this.pair(2, 'Standard').pair(70, '0').pair(0, 'ENDTAB');
  }

  private layerRecord(table: string, name: string, aci: number, rgb: number | null): void {
    this.record('LAYER', table, 'AcDbLayerTableRecord');
    this.pair(2, name).pair(70, '0').pair(62, String(aci));
    if (rgb !== null) this.pair(420, String(rgb));
    this.pair(6, 'Continuous');
  }

  private blocks(spaces: { readonly model: string; readonly paper: string }): void {
    this.section('BLOCKS');
    for (const [name, owner, paper] of [
      ['*Model_Space', spaces.model, false],
      ['*Paper_Space', spaces.paper, true],
    ] as const) {
      this.pair(0, 'BLOCK').pair(5, this.handle()).pair(330, owner).pair(100, 'AcDbEntity');
      if (paper) this.pair(67, '1');
      this.pair(8, '0').pair(100, 'AcDbBlockBegin').pair(2, name).pair(70, '0');
      this.point(0, 0).pair(3, name).pair(1, '');
      this.pair(0, 'ENDBLK').pair(5, this.handle()).pair(330, owner).pair(100, 'AcDbEntity');
      if (paper) this.pair(67, '1');
      this.pair(8, '0').pair(100, 'AcDbBlockEnd');
    }
    this.pair(0, 'ENDSEC');
  }

  private entities(polylines: ReadonlyArray<Polyline>, owner: string): void {
    this.section('ENTITIES');
    for (const polyline of polylines) {
      this.pair(0, 'LWPOLYLINE').pair(5, this.handle()).pair(330, owner);
      this.pair(100, 'AcDbEntity').pair(8, polyline.layer);
      this.pair(62, String(polyline.aci)).pair(420, String(polyline.rgb));
      this.pair(100, 'AcDbPolyline').pair(90, String(polyline.vertices.length));
      this.pair(70, polyline.closed ? '1' : '0').pair(43, '0.0');
      for (const vertex of polyline.vertices) {
        this.pair(10, formatGridIndex(vertex.x, this.grid));
        this.pair(20, formatGridIndex(vertex.y, this.grid));
        if (vertex.bulge !== 0) this.pair(42, bulgeText(vertex.bulge));
      }
    }
    this.pair(0, 'ENDSEC');
  }

  private objects(): void {
    const root = this.handle();
    const group = this.handle();
    this.section('OBJECTS');
    this.pair(0, 'DICTIONARY').pair(5, root).pair(330, '0').pair(100, 'AcDbDictionary');
    this.pair(281, '1').pair(3, 'ACAD_GROUP').pair(350, group);
    this.pair(0, 'DICTIONARY').pair(5, group).pair(330, root).pair(100, 'AcDbDictionary');
    this.pair(281, '1').pair(0, 'ENDSEC');
  }

  private table(name: string, count: number): string {
    const handle = this.handle();
    this.pair(0, 'TABLE').pair(2, name).pair(5, handle).pair(330, '0');
    this.pair(100, 'AcDbSymbolTable').pair(70, String(count));
    return handle;
  }

  private emptyTable(name: string): void {
    this.table(name, 0);
    this.pair(0, 'ENDTAB');
  }

  private record(type: string, owner: string, subclass: string): string {
    const handle = this.handle();
    this.pair(0, type).pair(5, handle).pair(330, owner);
    this.pair(100, 'AcDbSymbolTableRecord').pair(100, subclass);
    return handle;
  }

  private section(name: string): this {
    return this.pair(0, 'SECTION').pair(2, name);
  }

  private variable(name: string, code: number, value: string): void {
    this.pair(9, name).pair(code, value);
  }

  private point(x: number, y: number): this {
    const text = (v: number): string => formatGridIndex(gridIndex(v, this.grid), this.grid);
    return this.pair(10, text(x)).pair(20, text(y)).pair(30, '0');
  }

  private handle(): string {
    const value = hex(this.nextHandle);
    this.nextHandle += 1;
    return value;
  }

  private pair(code: number, value: string): this {
    this.lines.push(String(code).padStart(3, ' '), value);
    return this;
  }
}

function hex(value: number): string {
  return value.toString(16).toUpperCase();
}

function bulgeText(bulge: number): string {
  const fixed = bulge.toFixed(15).replace(/0+$/, '').replace(/\.$/, '');
  return fixed === '-0' ? '0' : fixed;
}
