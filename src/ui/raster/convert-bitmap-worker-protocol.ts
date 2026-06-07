import type { RasterImage } from '../../core/scene';
import type { BitmapConversionOptions, ConvertibleVector } from './bitmap-assembly';

export type ConvertBitmapWorkerRequest = {
  readonly id: number;
  readonly rasterId: string;
  readonly vector: ConvertibleVector;
  readonly options: BitmapConversionOptions;
};

export type ConvertBitmapWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'ok';
      readonly raster: RasterImage;
    }
  | {
      readonly id: number;
      readonly kind: 'error';
      readonly message: string;
    };
