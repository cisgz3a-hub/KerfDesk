import type { TracePreparationRequest } from './prepared-trace';
import type { TracePreviewState } from './use-trace-preview';
import type { TraceResult } from './use-trace-worker-client';

type ReadyPreview = Extract<TracePreviewState, { kind: 'ready' }>;
type CacheEntry = {
  readonly preview: ReadyPreview;
  readonly result: TraceResult;
  readonly bytes: number;
};
type CacheLimits = { readonly maxEntries?: number; readonly maxBytes?: number };

/** One source's recently viewed results. Budget is conservative accounting,
 * not a browser heap measurement; an oversized trace is simply not retained. */
export class TracePreviewCache {
  private readonly entries = new Map<string, CacheEntry>();
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(
    private readonly file: File,
    limits: CacheLimits = {},
  ) {
    this.maxEntries = limits.maxEntries ?? 3;
    this.maxBytes = limits.maxBytes ?? 32 * 1024 * 1024;
  }

  get(request: TracePreparationRequest): ReadyPreview | undefined {
    if (request.file !== this.file) return undefined;
    const key = requestKey(request);
    if (key === undefined) return undefined;
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    // Presets recreate options objects. Submit must own the current request,
    // while geometry and the already-serialized SVG remain shared.
    return { ...entry.preview, preparedTrace: { request, result: entry.result } };
  }

  remember(request: TracePreparationRequest, preview: ReadyPreview): void {
    if (request.file !== this.file || preview.preparedTrace === undefined) return;
    const key = requestKey(request);
    if (key === undefined) return;
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    const bytes = previewBytes(preview, key, this.maxBytes);
    if (bytes > this.maxBytes || this.maxEntries < 1) return;
    this.entries.set(key, { preview, result: preview.preparedTrace.result, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].bytes;
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

function requestKey(request: TracePreparationRequest): string | undefined {
  const options = Object.entries(request.options).filter(([, value]) => value !== undefined);
  const region = [
    request.boundaryMode,
    request.boundary === null
      ? null
      : [request.boundary.x, request.boundary.y, request.boundary.width, request.boundary.height],
    request.sourceGrid === undefined ? null : [request.sourceGrid.width, request.sourceGrid.height],
  ];
  if (options.some(([, value]) => typeof value === 'number' && !Number.isFinite(value)))
    return undefined;
  const coordinates = [
    ...Object.values(request.boundary ?? {}),
    ...Object.values(request.sourceGrid ?? {}),
  ];
  if (coordinates.some((value) => !Number.isFinite(value))) return undefined;
  options.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([options, region]);
}

function previewBytes(preview: ReadyPreview, key: string, limit: number): number {
  let bytes = 512 + 2 * (preview.svg.length + key.length);
  for (const path of preview.paths) {
    bytes += 128 + 2 * path.color.length;
    for (const line of path.polylines) bytes += 96 + 48 * line.points.length;
    // Include both representations when present. Curves can contain several
    // control-point objects per segment, unlike the polyline compatibility view.
    for (const curve of path.curves ?? []) bytes += 256 + 256 * curve.segments.length;
    if (bytes > limit) return bytes;
  }
  return bytes;
}
