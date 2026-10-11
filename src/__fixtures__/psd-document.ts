// Independent minimal PSD writer for structure/alpha tests; no ag-psd writer.
type PsdFixtureOptions = {
  readonly gray?: boolean;
  readonly alpha?: boolean;
  readonly mergedAlpha?: boolean;
  readonly rle?: boolean;
  /** Stored X/Y pixels per inch, each followed by its display-unit selector. */
  readonly resolution?: readonly [number, number, number, number];
  readonly hasMergedPreview?: boolean;
  readonly profile?: boolean;
};
const u16 = (v: number): number[] => [(v >>> 8) & 255, v & 255];
const u32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, ...u16(v)];
const text = (value: string): number[] => Array.from(value, (c) => c.charCodeAt(0));
const sized = (bytes: number[]): number[] => [...u32(bytes.length), ...bytes];
const resource = (id: number, data: number[]): number[] => [
  ...text('8BIM'),
  ...u16(id),
  0,
  0,
  ...sized(data),
  ...(data.length % 2 ? [0] : []),
];

function colorPlanes(options: PsdFixtureOptions): number[][] {
  const planes = options.gray
    ? [[0, 90, 255]]
    : [
        [20, 40, 60],
        [70, 90, 110],
        [120, 140, 160],
      ];
  if (options.mergedAlpha) {
    // Independent forward white matte, inverted by the import adapter. The
    // middle colour may round by one level at 8-bit precision.
    for (const plane of planes) {
      plane[0] = 255;
      plane[1] = Math.round(((plane[1] ?? 0) * 128 + 255 * 127) / 255);
    }
  }
  if (options.alpha) planes.push([0, 128, 255]);
  return planes;
}

export function psdDocument(options: PsdFixtureOptions = {}): Uint8Array<ArrayBuffer> {
  const planes = colorPlanes(options);
  const header = [
    ...text('8BPS'),
    ...u16(1),
    0,
    0,
    0,
    0,
    0,
    0,
    ...u16(planes.length),
    ...u32(1),
    ...u32(3),
    ...u16(8),
    ...u16(options.gray ? 1 : 3),
  ];
  const resources: number[] = [];
  if (options.resolution) {
    const [x, xUnit, y, yUnit] = options.resolution;
    resources.push(
      ...resource(1005, [
        ...u32(x * 65536),
        ...u16(xUnit),
        ...u16(1),
        ...u32(y * 65536),
        ...u16(yUnit),
        ...u16(1),
      ]),
    );
  }
  if (options.hasMergedPreview !== undefined)
    resources.push(
      ...resource(1057, [
        ...u32(1),
        options.hasMergedPreview ? 1 : 0,
        ...u32(0),
        ...u32(0),
        ...u32(1),
      ]),
    );
  if (options.profile) resources.push(...resource(1039, [1, 2, 3, 4]));
  // An empty layer with a valid record establishes the merged-alpha flag. The
  // composite carries its own complete pixels, independently of layer content.
  const layerRecord = [
    ...u32(0),
    ...u32(0),
    ...u32(1),
    ...u32(3),
    ...u16(0),
    ...text('8BIMnorm'),
    255,
    0,
    0,
    0,
    ...u32(12),
    ...u32(0),
    ...u32(0),
    0,
    0,
    0,
    0,
  ];
  const layers = options.mergedAlpha ? [...sized([...u16(65535), ...layerRecord]), ...u32(0)] : [];
  const pixels = options.rle
    ? [...planes.flatMap(() => u16(4)), ...planes.flatMap((p) => [2, ...p])]
    : planes.flat();
  return new Uint8Array([
    ...header,
    ...sized([]),
    ...sized(resources),
    ...sized(layers),
    ...u16(options.rle ? 1 : 0),
    ...pixels,
  ]);
}
