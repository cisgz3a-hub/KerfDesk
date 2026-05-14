import { errorReporter } from '../app/ErrorReporter';
import { getMachineEventLedger } from '../app/MachineEventLedger';
import { getJobLogs } from '../core/job/JobLog';
import { getStorage } from '../core/storage/storage';
import {
  buildSupportBundle,
  type SupportBundle,
  type SupportBundleInclusions,
  type SupportBundleInputs,
} from './SupportBundle';
import { emptyCorrelationIds, generateCorrelationId } from './CorrelationIds';
import { buildStorageHealth, emptyStorageHealth } from './StorageHealth';

export type SupportBundleSaveMethod = 'electron-dialog' | 'browser-download' | 'none';

export type SupportBundleSaveResult =
  | {
    ok: true;
    method: Exclude<SupportBundleSaveMethod, 'none'>;
    filename: string;
  }
  | {
    ok: false;
    method: SupportBundleSaveMethod;
    filename: string;
    reason: 'cancelled' | 'failed' | 'unsupported';
    message: string;
  };

export interface BuildRuntimeSupportBundleOptions {
  machineProfile?: unknown;
  inclusions?: Partial<SupportBundleInclusions>;
  gcodeByJobId?: Record<string, string>;
  projectFileJson?: unknown;
  images?: Array<{ id: string; dataUri: string }>;
  generatedAt?: string;
}

interface ElectronBinarySaveApi {
  saveBinaryFile?: (defaultName: string, base64Content: string) => Promise<boolean>;
}

interface DownloadDom {
  createElement(tagName: 'a'): HTMLAnchorElement;
  body?: {
    appendChild(node: Node): Node;
    removeChild(node: Node): Node;
  };
}

const UTF8_FLAG = 0x0800;
const textEncoder = new TextEncoder();

export async function buildRuntimeSupportBundle(
  opts: BuildRuntimeSupportBundleOptions = {},
): Promise<SupportBundle> {
  const supportBundleId = generateCorrelationId('bundle');
  const correlationIds = {
    ...emptyCorrelationIds(),
    supportBundleId,
  };
  const storageHealth = await collectStorageHealth();
  const inputs: SupportBundleInputs = {
    appInfo: readAppInfo(),
    systemInfo: readSystemInfo(),
    correlationIds,
    jobLogs: await getJobLogs(),
    errors: [...errorReporter.getHistory()],
    machineProfile: opts.machineProfile,
    storage: storageHealth,
    machineEventLedger: getMachineEventLedger().serializeForSupport(),
    gcodeByJobId: opts.gcodeByJobId,
    projectFileJson: opts.projectFileJson,
    images: opts.images,
  };

  return buildSupportBundle({
    inputs,
    inclusions: opts.inclusions,
    bundleId: supportBundleId,
    generatedAt: opts.generatedAt,
  });
}

export async function exportRuntimeSupportBundle(
  opts: BuildRuntimeSupportBundleOptions = {},
): Promise<SupportBundleSaveResult> {
  const bundle = await buildRuntimeSupportBundle(opts);
  return saveSupportBundleZip(bundle);
}

export function supportBundleZipFileName(bundle: SupportBundle): string {
  const id = bundle.manifest.bundleId || 'unknown';
  const safeId = id.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  return `laserforge-support-${safeId}.zip`;
}

export function buildSupportBundleZip(bundle: SupportBundle): Uint8Array {
  const entries = orderedBundleEntries(bundle);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = textEncoder.encode(name);
    const data = textEncoder.encode(content);
    const crc = crc32(data);
    const local = createLocalFileHeader(nameBytes, data.length, crc);
    localParts.push(local, data);
    centralParts.push(createCentralDirectoryHeader(nameBytes, data.length, crc, offset));
    offset += local.length + data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = concatBytes(centralParts);
  const end = createEndOfCentralDirectory(entries.length, centralDirectory.length, centralDirectoryOffset);
  return concatBytes([...localParts, centralDirectory, end]);
}

export async function saveSupportBundleZip(
  bundle: SupportBundle,
): Promise<SupportBundleSaveResult> {
  const filename = supportBundleZipFileName(bundle);
  const zipBytes = buildSupportBundleZip(bundle);
  const electronSave = readElectronBinarySaveApi()?.saveBinaryFile;
  if (electronSave) {
    try {
      const saved = await electronSave(filename, bytesToBase64(zipBytes));
      if (!saved) {
        return {
          ok: false,
          method: 'electron-dialog',
          filename,
          reason: 'cancelled',
          message: 'Support bundle export was cancelled.',
        };
      }
      return { ok: true, method: 'electron-dialog', filename };
    } catch (err) {
      return {
        ok: false,
        method: 'electron-dialog',
        filename,
        reason: 'failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return saveViaBrowserDownload(filename, zipBytes);
}

function orderedBundleEntries(bundle: SupportBundle): Array<[string, string]> {
  const entries = Object.entries(bundle.files)
    .sort(([a], [b]) => a.localeCompare(b));
  const manifestIndex = entries.findIndex(([name]) => name === 'manifest.json');
  if (manifestIndex > 0) {
    const [manifest] = entries.splice(manifestIndex, 1);
    entries.unshift(manifest);
  }
  return entries;
}

function readElectronBinarySaveApi(): ElectronBinarySaveApi | null {
  if (typeof window === 'undefined') return null;
  return (window.electronAPI as ElectronBinarySaveApi | undefined) ?? null;
}

function saveViaBrowserDownload(
  filename: string,
  zipBytes: Uint8Array,
): SupportBundleSaveResult {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return {
      ok: false,
      method: 'none',
      filename,
      reason: 'unsupported',
      message: 'This environment cannot download files.',
    };
  }

  try {
    const doc = document as DownloadDom;
    const blobBytes = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([blobBytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    doc.body?.appendChild(anchor);
    anchor.click();
    doc.body?.removeChild(anchor);
    URL.revokeObjectURL(url);
    return { ok: true, method: 'browser-download', filename };
  } catch (err) {
    return {
      ok: false,
      method: 'browser-download',
      filename,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function collectStorageHealth() {
  try {
    const storage = getStorage();
    const keys = await storage.list();
    const entries = await Promise.all(keys.map(async (key) => [key, await storage.get(key)] as [string, unknown]));
    const quota = await readStorageEstimate();
    return buildStorageHealth({
      entries,
      quotaBytesUsed: quota?.usage,
      quotaBytesAvailable: quota?.quota,
    });
  } catch {
    return emptyStorageHealth();
  }
}

async function readStorageEstimate(): Promise<{ usage?: number; quota?: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

function readAppInfo(): SupportBundleInputs['appInfo'] {
  return {
    version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-tsx-fallback',
    buildChannel: readBuildChannel(),
    electron: readProcessVersion('electron'),
    chromium: readProcessVersion('chrome'),
    node: readProcessVersion('node'),
  };
}

function readBuildChannel(): SupportBundleInputs['appInfo']['buildChannel'] {
  if (typeof __BUILD_COMMIT__ !== 'undefined' && __BUILD_COMMIT__ !== 'dev') return 'beta';
  return 'dev';
}

function readProcessVersion(kind: 'electron' | 'chrome' | 'node'): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.versions?.[kind];
}

function readSystemInfo(): SupportBundleInputs['systemInfo'] {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const screenInfo = typeof screen === 'undefined'
    ? undefined
    : { width: screen.width, height: screen.height };
  return {
    platform: nav?.platform ?? readNodePlatform(),
    arch: readNodeArch(),
    locale: nav?.language,
    screen: screenInfo,
  };
}

function readNodePlatform(): string {
  if (typeof process === 'undefined') return 'unknown';
  return process.platform;
}

function readNodeArch(): string {
  if (typeof process === 'undefined') return 'unknown';
  return process.arch;
}

function createLocalFileHeader(nameBytes: Uint8Array, dataLength: number, crc: number): Uint8Array {
  const out = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(out.buffer);
  writeU32(view, 0, 0x04034b50);
  writeU16(view, 4, 20);
  writeU16(view, 6, UTF8_FLAG);
  writeU16(view, 8, 0);
  writeU16(view, 10, 0);
  writeU16(view, 12, 0);
  writeU32(view, 14, crc);
  writeU32(view, 18, dataLength);
  writeU32(view, 22, dataLength);
  writeU16(view, 26, nameBytes.length);
  writeU16(view, 28, 0);
  out.set(nameBytes, 30);
  return out;
}

function createCentralDirectoryHeader(
  nameBytes: Uint8Array,
  dataLength: number,
  crc: number,
  localOffset: number,
): Uint8Array {
  const out = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(out.buffer);
  writeU32(view, 0, 0x02014b50);
  writeU16(view, 4, 20);
  writeU16(view, 6, 20);
  writeU16(view, 8, UTF8_FLAG);
  writeU16(view, 10, 0);
  writeU16(view, 12, 0);
  writeU16(view, 14, 0);
  writeU32(view, 16, crc);
  writeU32(view, 20, dataLength);
  writeU32(view, 24, dataLength);
  writeU16(view, 28, nameBytes.length);
  writeU16(view, 30, 0);
  writeU16(view, 32, 0);
  writeU16(view, 34, 0);
  writeU16(view, 36, 0);
  writeU32(view, 38, 0);
  writeU32(view, 42, localOffset);
  out.set(nameBytes, 46);
  return out;
}

function createEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  const out = new Uint8Array(22);
  const view = new DataView(out.buffer);
  writeU32(view, 0, 0x06054b50);
  writeU16(view, 4, 0);
  writeU16(view, 6, 0);
  writeU16(view, 8, entryCount);
  writeU16(view, 10, entryCount);
  writeU32(view, 12, centralDirectorySize);
  writeU32(view, 16, centralDirectoryOffset);
  writeU16(view, 20, 0);
  return out;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
    }
    return btoa(binary);
  }
  const maybeBuffer = (globalThis as {
    Buffer?: { from(data: Uint8Array): { toString(encoding: 'base64'): string } };
  }).Buffer;
  if (maybeBuffer) return maybeBuffer.from(bytes).toString('base64');
  throw new Error('No base64 encoder available for support bundle export');
}

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}
