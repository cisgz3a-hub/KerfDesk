export type ShapedGlyph = {
  readonly id: number;
  /** UTF-16 source index, shared by all glyphs in the same shaping cluster. */
  readonly cluster: number;
  readonly x: number;
  readonly y: number;
  readonly trackingIndex: number;
};

export type ShapedLine = {
  readonly glyphs: ReadonlyArray<ShapedGlyph>;
  readonly advance: number;
  readonly trackingGaps: number;
};

/** Font-unit layout, independent of point size and canvas coordinates. */
export type TextShaping = {
  readonly content: string;
  readonly fontBuffer: ArrayBuffer;
  readonly line: (start: number, end: number) => ShapedLine;
  readonly breakUnits: (text: string, sourceStart: number) => ReadonlyArray<string>;
};
