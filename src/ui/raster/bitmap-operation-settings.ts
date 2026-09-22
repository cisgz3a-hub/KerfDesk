import {
  createLayer,
  outputOperationLayers,
  type Layer,
  type LayerMode,
  type LayerSubLayer,
} from '../../core/scene';

export type BitmapLayerSetting = {
  readonly id?: string;
  readonly color: string;
  readonly mode: LayerMode;
  readonly output?: boolean;
  readonly subLayers?: ReadonlyArray<LayerSubLayer>;
};

export function captureBitmapLayerSettings(
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<BitmapLayerSetting> {
  return layers.map(({ id, color, mode, output, subLayers }) => ({
    id,
    color,
    mode,
    output,
    subLayers,
  }));
}

// Legacy callers supply just a colour and mode. Materialize those defaults
// before using the compiler's canonical parent/sub-layer output expansion.
export function bitmapOperationLayers(layer: BitmapLayerSetting): ReadonlyArray<Layer> {
  return outputOperationLayers({
    ...createLayer({
      id: layer.id ?? `color:${layer.color.toLowerCase()}`,
      color: layer.color,
      mode: layer.mode,
    }),
    output: layer.output ?? true,
    subLayers: layer.subLayers ?? [],
  });
}

export function bitmapLayerSettingsSignature(layers: ReadonlyArray<BitmapLayerSetting>): string {
  return JSON.stringify(
    layers.map((layer) => [
      layer.id,
      layer.color,
      layer.output ?? true,
      bitmapOperationLayers(layer).map((operation) => [operation.id, operation.mode]),
    ]),
  );
}
