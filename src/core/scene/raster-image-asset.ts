export type PagedRasterImageAsset = {
  readonly schemaVersion: 1;
  readonly repository: 'curvedesk-import-assets-v1';
  readonly sourceAssetId: string;
  readonly lumaAssetId: string;
  readonly sourceMimeType: string;
  readonly sourceByteLength: number;
  readonly lumaByteLength: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly sampledWidth: number;
  readonly sampledHeight: number;
  readonly thumbnail: {
    readonly mimeType: 'image/bmp';
    readonly dataUrl: string;
    readonly width: number;
    readonly height: number;
  };
};
