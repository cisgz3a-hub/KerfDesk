import type { RasterToolpathSource, ToolpathStep } from '../../core/job/toolpath-types';
import type { Vec2 } from '../../core/scene';

const TRAVEL_FIELDS = new Set(['kind', 'from', 'to', 'length', 'motion']);
const CUT_FIELDS = new Set(['kind', 'color', 'source', 'polyline', 'length']);
const POINT_FIELDS = new Set(['x', 'y']);
const SOURCE_FIELDS = new Set([
  'kind',
  'objectId',
  'source',
  'passIndex',
  'rowIndex',
  'spanIndex',
  'pixelStartX',
  'pixelEndX',
]);

/**
 * Native clones repeat raster strings and inflate ordinary point records.
 * Recreate the known records with local constructors and one string pool for
 * this transfer. Rich or extended records keep their complete cloned value.
 */
export class PreparationStepRehydrator {
  private readonly strings = new Map<string, string>();

  rehydrate(step: ToolpathStep): ToolpathStep {
    if (step.kind === 'travel') return this.travel(step);
    if (
      step.kind !== 'cut' ||
      !hasOnlyFields(step, CUT_FIELDS) ||
      typeof step.color !== 'string' ||
      typeof step.length !== 'number' ||
      !Array.isArray(step.polyline) ||
      step.polyline.length !== 2 ||
      Reflect.ownKeys(step.polyline).length !== 3 ||
      !plainPoint(step.polyline[0]) ||
      !plainPoint(step.polyline[1]) ||
      !plainRasterSource(step.source)
    ) {
      return step;
    }
    return {
      kind: 'cut',
      color: this.intern(step.color),
      source: this.source(step.source),
      polyline: [point(step.polyline[0]), point(step.polyline[1])],
      length: step.length,
    };
  }

  private travel(step: Extract<ToolpathStep, { readonly kind: 'travel' }>): ToolpathStep {
    if (
      !hasOnlyFields(step, TRAVEL_FIELDS) ||
      typeof step.length !== 'number' ||
      !plainPoint(step.from) ||
      !plainPoint(step.to) ||
      (Object.hasOwn(step, 'motion') && step.motion !== 'rapid' && step.motion !== 'feed')
    ) {
      return step;
    }
    const from = point(step.from);
    const to = point(step.to);
    if (step.motion === undefined) return { kind: 'travel', from, to, length: step.length };
    return {
      kind: 'travel',
      from,
      to,
      length: step.length,
      motion: step.motion === 'rapid' ? 'rapid' : 'feed',
    };
  }

  private source(source: RasterToolpathSource): RasterToolpathSource {
    // The usual raster has both labels. Keep its constructor explicit to
    // reproduce the compact local record shape measured in native Chrome.
    if (source.objectId !== undefined && source.source !== undefined) {
      return {
        kind: 'raster',
        objectId: this.intern(source.objectId),
        source: this.intern(source.source),
        passIndex: source.passIndex,
        rowIndex: source.rowIndex,
        spanIndex: source.spanIndex,
        pixelStartX: source.pixelStartX,
        pixelEndX: source.pixelEndX,
      };
    }
    return {
      kind: 'raster',
      ...(source.objectId === undefined ? {} : { objectId: this.intern(source.objectId) }),
      ...(source.source === undefined ? {} : { source: this.intern(source.source) }),
      passIndex: source.passIndex,
      rowIndex: source.rowIndex,
      spanIndex: source.spanIndex,
      pixelStartX: source.pixelStartX,
      pixelEndX: source.pixelEndX,
    };
  }

  private intern(value: string): string {
    const previous = this.strings.get(value);
    if (previous !== undefined) return previous;
    this.strings.set(value, value);
    return value;
  }
}

function hasOnlyFields(value: object, fields: ReadonlySet<string>): boolean {
  return (
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && fields.has(key))
  );
}

function plainPoint(value: Vec2 | undefined): value is Vec2 {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    hasOnlyFields(value, POINT_FIELDS)
  );
}

function plainRasterSource(value: RasterToolpathSource | undefined): value is RasterToolpathSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.kind === 'raster' &&
    hasOnlyFields(value, SOURCE_FIELDS) &&
    optionalString(value, 'objectId') &&
    optionalString(value, 'source') &&
    typeof value.passIndex === 'number' &&
    typeof value.rowIndex === 'number' &&
    typeof value.spanIndex === 'number' &&
    typeof value.pixelStartX === 'number' &&
    typeof value.pixelEndX === 'number'
  );
}

function optionalString(value: RasterToolpathSource, key: 'objectId' | 'source'): boolean {
  return !Object.hasOwn(value, key) || typeof value[key] === 'string';
}

function point(value: Vec2): Vec2 {
  // Assignment preserves doubles and negative zero; no coordinate arithmetic.
  return { x: value.x, y: value.y };
}
