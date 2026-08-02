import {
  DEFAULT_ASSET_PAGE_BYTES,
  type PagedAssetManifest,
  type PagedAssetSink,
} from './paged-asset-stager';

export type PagedAssetByteWriterOptions = {
  readonly assetId: string;
  readonly sourceName: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly createdAtEpochMs: number;
  readonly pageBytes?: number;
  readonly onProgress?: (bytesProcessed: number, totalBytes: number) => void;
};

export class PagedAssetByteWriter {
  private readonly pageBytes: number;
  private readonly buffer: Uint8Array<ArrayBuffer>;
  private bufferLength = 0;
  private pageIndex = 0;
  private acceptedBytes = 0;
  private finished = false;

  private constructor(
    private readonly sink: PagedAssetSink,
    private readonly options: PagedAssetByteWriterOptions,
  ) {
    this.pageBytes = options.pageBytes ?? DEFAULT_ASSET_PAGE_BYTES;
    this.buffer = new Uint8Array(this.pageBytes);
  }

  static async create(
    sink: PagedAssetSink,
    options: PagedAssetByteWriterOptions,
  ): Promise<PagedAssetByteWriter> {
    assertNonNegativeSafeInteger(options.byteLength, 'byteLength');
    const pageBytes = options.pageBytes ?? DEFAULT_ASSET_PAGE_BYTES;
    assertPositiveSafeInteger(pageBytes, 'pageBytes');
    const writer = new PagedAssetByteWriter(sink, options);
    await sink.begin(writer.manifest('staging', 0));
    return writer;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.finished) throw new Error('Paged asset writer is already finished.');
    if (this.acceptedBytes + bytes.byteLength > this.options.byteLength) {
      throw new Error('Paged asset output exceeds its declared byte length.');
    }
    let offset = 0;
    while (offset < bytes.byteLength) {
      const take = Math.min(this.pageBytes - this.bufferLength, bytes.byteLength - offset);
      this.buffer.set(bytes.subarray(offset, offset + take), this.bufferLength);
      this.bufferLength += take;
      this.acceptedBytes += take;
      offset += take;
      if (this.bufferLength === this.pageBytes) await this.flush();
    }
  }

  async finish(): Promise<PagedAssetManifest> {
    if (this.finished) throw new Error('Paged asset writer is already finished.');
    if (this.acceptedBytes !== this.options.byteLength) {
      throw new Error(
        `Paged asset output has ${this.acceptedBytes} bytes; expected ${this.options.byteLength}.`,
      );
    }
    if (this.bufferLength > 0) await this.flush();
    const ready = this.manifest('ready', this.acceptedBytes);
    await this.sink.commit(ready);
    this.finished = true;
    return ready;
  }

  async abort(): Promise<void> {
    if (this.finished) return;
    await this.sink.abort(this.options.assetId);
    this.finished = true;
  }

  private async flush(): Promise<void> {
    const page = new Blob([this.buffer.slice(0, this.bufferLength)], {
      type: this.options.mimeType,
    });
    await this.sink.writePage(this.options.assetId, this.pageIndex, page);
    this.pageIndex += 1;
    this.bufferLength = 0;
    this.options.onProgress?.(this.acceptedBytes, this.options.byteLength);
  }

  private manifest(
    state: PagedAssetManifest['state'],
    writtenByteLength: number,
  ): PagedAssetManifest {
    return {
      schemaVersion: 1,
      assetId: this.options.assetId,
      sourceName: this.options.sourceName,
      mimeType: this.options.mimeType,
      byteLength: this.options.byteLength,
      writtenByteLength,
      pageBytes: this.pageBytes,
      pageCount: Math.ceil(this.options.byteLength / this.pageBytes),
      createdAtEpochMs: this.options.createdAtEpochMs,
      state,
    };
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}
