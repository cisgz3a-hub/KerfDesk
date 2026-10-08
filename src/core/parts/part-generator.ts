import type { Bounds, ColoredPath, ImportedSvg } from '../scene/scene-object';

export type PartGeneratorKind = 'panel' | 'bracket' | 'hole-grid' | 'fixture';
type Dimensions = {
  readonly name: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly holeDiameterMm: number;
};
export type PanelGenerator = Dimensions & { readonly kind: 'panel'; readonly edgeOffsetMm: number };
export type BracketGenerator = Dimensions & {
  readonly kind: 'bracket';
  readonly legWidthMm: number;
  readonly holeOffsetMm: number;
};
export type HoleGridGenerator = Dimensions & {
  readonly kind: 'hole-grid';
  readonly rows: number;
  readonly columns: number;
  readonly edgeOffsetMm: number;
};
export type FixtureGenerator = Dimensions & {
  readonly kind: 'fixture';
  readonly rows: number;
  readonly columns: number;
  readonly edgeOffsetMm: number;
  readonly mountOffsetMm: number;
  readonly mountDiameterMm: number;
};
export type PartGeneratorDefinition =
  | PanelGenerator
  | BracketGenerator
  | HoleGridGenerator
  | FixtureGenerator;
export type PartGeneratorSource = {
  readonly version: 1;
  readonly definition: PartGeneratorDefinition;
  readonly pathKeys: ReadonlyArray<string>;
};
export type PartGeneratorGeometry = {
  readonly bounds: Bounds;
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly source: PartGeneratorSource;
};
export type PartGeneratorResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'invalid'; readonly reason: string };
export type GeneratedPartObject = ImportedSvg & { readonly partGenerator: PartGeneratorSource };
export const PART_GENERATOR_COLOR = '#000000';
export const PART_GENERATOR_MAX_HOLES = 512;
export function defaultPartGenerator(kind: PartGeneratorKind): PartGeneratorDefinition {
  const dimensions = {
    name: kind === 'hole-grid' ? 'Hole grid' : kind[0]?.toUpperCase() + kind.slice(1),
    widthMm: 60,
    heightMm: kind === 'fixture' ? 60 : 40,
    holeDiameterMm: 4,
  };
  switch (kind) {
    case 'panel':
      return { ...dimensions, kind, edgeOffsetMm: 8 };
    case 'bracket':
      return { ...dimensions, kind, legWidthMm: 12, holeOffsetMm: 8 };
    case 'hole-grid':
      return { ...dimensions, kind, rows: 3, columns: 4, edgeOffsetMm: 8 };
    case 'fixture':
      return {
        ...dimensions,
        kind,
        rows: 2,
        columns: 3,
        edgeOffsetMm: 20,
        mountOffsetMm: 8,
        mountDiameterMm: 5,
      };
  }
}
