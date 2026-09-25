import type { Bounds, ColoredPath, ImportedSvg, Transform } from '../../core/scene';

/** Decoded later by the UI; the XML worker never acquires raster storage. */
export type SvgImageDescriptor = {
  readonly kind: 'svg-image';
  readonly id: string;
  readonly source: string;
  readonly dataUrl: string;
  readonly bounds: Bounds;
  readonly transform: Transform;
  readonly imageClip?: readonly ColoredPath[];
};

export type SvgImportEntry = ImportedSvg | SvgImageDescriptor;

export type ParsedSvgFragment = {
  readonly source: string;
  readonly bounds: Bounds;
  readonly entries: readonly SvgImportEntry[];
};
